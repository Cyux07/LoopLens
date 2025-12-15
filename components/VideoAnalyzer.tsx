import React, { useRef, useState, useEffect, useCallback } from 'react';
import { AnalysisConfig, DetectedLoop, LogEntry, AppState } from '../types';
import { Play, Pause, Activity, Minimize2 } from 'lucide-react';

interface VideoAnalyzerProps {
  file: File | null;
  config: AnalysisConfig;
  appState: AppState;
  setAppState: (state: AppState) => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  onLoopsDetected: (loops: DetectedLoop[]) => void;
  onProgress: (progress: number) => void;
  onMotionDataUpdate: (data: {time: number, value: number}[]) => void;
  previewLoop: DetectedLoop | null;
}

export const VideoAnalyzer: React.FC<VideoAnalyzerProps> = ({
  file,
  config,
  appState,
  setAppState,
  addLog,
  onLoopsDetected,
  onProgress,
  onMotionDataUpdate,
  previewLoop
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPip, setIsPip] = useState(false);

  // --- PiP LOGIC ---
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        // If sentinel is NOT intersecting, it means we scrolled past it -> Enable PiP
        // We only enable PiP if video is loaded
        if (appState !== AppState.IDLE && !entry.isIntersecting && entry.boundingClientRect.top < 0) {
            setIsPip(true);
        } else {
            setIsPip(false);
        }
      },
      { threshold: 0 }
    );

    if (sentinelRef.current) {
        observer.observe(sentinelRef.current);
    }

    return () => observer.disconnect();
  }, [appState]);


  // --- VIDEO LOAD LOGIC ---
  useEffect(() => {
    if (file) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setAppState(AppState.LOADING_VIDEO);
      setIsPlaying(false);
      setCurrentTime(0);
      onLoopsDetected([]);
      onMotionDataUpdate([]);
      addLog('info', `Loaded: ${file.name}`);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  // --- PREVIEW LOGIC ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video || appState !== AppState.READY) return;
    if (previewLoop) {
      video.currentTime = previewLoop.startTime;
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [previewLoop, appState]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const t = videoRef.current.currentTime;
      setCurrentTime(t);
      if (previewLoop && isPlaying && t >= previewLoop.endTime) {
           videoRef.current.currentTime = previewLoop.startTime;
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setAppState(AppState.READY);
    }
  };

  // --- CORE ANALYSIS LOGIC ---
  const startAnalysis = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !file) return;
    
    setAppState(AppState.ANALYZING);
    addLog('info', `Starting hybrid analysis (V:${100-config.audioWeight}% / A:${config.audioWeight}%) at ${config.samplingRate} FPS...`);
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) {
      addLog('error', 'Canvas context failed');
      setAppState(AppState.READY);
      return;
    }

    // -- AUDIO SETUP --
    let audioBuffer: AudioBuffer | null = null;
    if (config.audioWeight > 0) {
        try {
            addLog('info', 'Decoding audio track for beat detection...');
            const arrayBuffer = await file.arrayBuffer();
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
            audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            addLog('success', 'Audio track decoded.');
        } catch (e) {
            addLog('warn', 'Failed to decode audio. Falling back to video-only analysis.');
        }
    }

    // Config
    const fps = config.samplingRate; 
    const interval = 1 / fps;
    const duration = video.duration;
    
    // Lower res for processing
    const processWidth = 48;
    const processHeight = 48;
    
    canvas.width = processWidth;
    canvas.height = processHeight;

    const combinedData: {time: number, value: number, isSceneCut?: boolean}[] = [];
    let prevFrameData: Uint8ClampedArray | null = null;
    let runningSum = 0;
    
    // Helper: Get Audio RMS at specific time
    const getAudioRMS = (time: number, windowSize: number = 0.05): number => {
        if (!audioBuffer) return 0;
        const sampleRate = audioBuffer.sampleRate;
        const startSample = Math.floor(time * sampleRate);
        const endSample = Math.floor((time + windowSize) * sampleRate);
        const channelData = audioBuffer.getChannelData(0); // Mono analysis
        
        let sumSq = 0;
        let count = 0;
        for (let i = startSample; i < endSample && i < channelData.length; i++) {
            sumSq += channelData[i] * channelData[i];
            count++;
        }
        if (count === 0) return 0;
        return Math.sqrt(sumSq / count) * 1000; // Scale up roughly to 0-255 range
    };

    // 1. DATA EXTRACTION PHASE
    const captureFrame = async (time: number): Promise<{vScore: number, variance: number}> => {
       return new Promise((resolve) => {
         const onSeek = () => {
           ctx.drawImage(video, 0, 0, processWidth, processHeight);
           const frame = ctx.getImageData(0, 0, processWidth, processHeight);
           let diffScore = 0;
           let pxSum = 0;
           let pxSumSq = 0;
           const pixelCount = frame.data.length / 4;

           // Gray-scale + Diff + Variance Calculation
           for (let i = 0; i < frame.data.length; i += 4) {
             const r = frame.data[i];
             const g = frame.data[i+1];
             const b = frame.data[i+2];
             const gray = 0.299*r + 0.587*g + 0.114*b;
             
             // Variance stats
             pxSum += gray;
             pxSumSq += gray * gray;

             if (prevFrameData) {
               const prevR = prevFrameData[i];
               const prevG = prevFrameData[i+1];
               const prevB = prevFrameData[i+2];
               const prevGray = 0.299*prevR + 0.587*prevG + 0.114*prevB;
               const diff = Math.abs(gray - prevGray);
               
               // Non-linear boost for small motion (Square Root)
               // This makes small changes more significant relative to large ones
               diffScore += Math.sqrt(diff);
             }
           }
           
           // Calculate Variance (Standard Deviation squared)
           const mean = pxSum / pixelCount;
           const variance = (pxSumSq / pixelCount) - (mean * mean);

           prevFrameData = frame.data;
           resolve({
             vScore: diffScore / pixelCount, 
             variance: variance
           }); 
         };
         
         video.addEventListener('seeked', onSeek, { once: true });
         video.currentTime = time;
       });
    };

    try {
        video.pause();

        for (let t = 0; t < duration; t += interval) {
            const {vScore, variance} = await captureFrame(t);
            const audioScore = getAudioRMS(t, interval);
            
            // BAD CASE FIX: Solid Screen Detection (Black/White frames)
            // If variance is very low, it's a solid color screen. Force video score to 0.
            let cleanVScore = vScore;
            if (variance < 10) { // Threshold for "solidness"
                cleanVScore = 0; 
            }

            // Normalization & Weights
            // We store raw values here, normalize later
            combinedData.push({ 
                time: t, 
                value: 0, // Placeholder
                isSceneCut: false 
            });

            // Store raw components for post-processing
            // @ts-ignore attached to object for temp storage
            combinedData[combinedData.length-1]._raw = { v: cleanVScore, a: audioScore };
            
            runningSum += cleanVScore;
            onProgress((t / duration) * 100);
            
            if (t % 1 < interval) await new Promise(r => setTimeout(r, 0));
        }

        // --- POST PROCESSING & FUSION ---

        // Calculate averages for dynamic normalization
        const avgV = combinedData.reduce((acc, d) => acc + (d as any)._raw.v, 0) / combinedData.length || 1;
        const avgA = combinedData.reduce((acc, d) => acc + (d as any)._raw.a, 0) / combinedData.length || 1;

        const processedData = combinedData.map(d => {
            const raw = (d as any)._raw;
            
            // Normalize relative to average activity (Dynamic Gain)
            let normV = raw.v / (avgV * 2); 
            let normA = raw.a / (avgA * 2);
            
            // Clamp
            normV = Math.min(1, normV);
            normA = Math.min(1, normA);

            // Weighting
            const wA = config.audioWeight / 100;
            const wV = 1 - wA;
            
            let fusedValue = (normV * wV) + (normA * wA);
            
            return { ...d, value: fusedValue * 255 }; // Scale back to visual range
        });


        // 1.1 Detect Scene Cuts (if enabled)
        if (config.detectSceneChanges) {
            // Scene cuts usually only manifest visually
            const visualRunningSum = combinedData.reduce((acc, d) => acc + (d as any)._raw.v, 0);
            const vAvg = visualRunningSum / combinedData.length;
            const threshold = vAvg * 6; 
            
            processedData.forEach((d, i) => {
                if ((d as any)._raw.v > threshold) d.isSceneCut = true;
            });
        }

        // 1.2 Detrending (High Pass Filter)
        let detrendedData = [...processedData];
        if (config.ignoreSteadyMotion) {
            const trendWindow = Math.floor(config.samplingRate * 1.5); 
            detrendedData = processedData.map((d, i, arr) => {
                let sum = 0;
                let count = 0;
                for (let j = Math.max(0, i - trendWindow); j <= Math.min(arr.length - 1, i + trendWindow); j++) {
                    sum += arr[j].value;
                    count++;
                }
                const trend = sum / count;
                // Subtract trend but keep positive
                return { ...d, value: Math.max(0, d.value - trend) }; 
            });
            addLog('info', 'Applied High-Pass filter (Steady Motion Removal).');
        }

        onMotionDataUpdate(detrendedData);

        // 2. PEAK DETECTION (Same logic as before, but on cleaner data)
        const windowSize = config.smoothingWindow || 2;
        const smoothedData = detrendedData.map((d, i, arr) => {
           let sum = 0;
           let count = 0;
           for(let j = Math.max(0, i - windowSize); j <= Math.min(arr.length - 1, i + windowSize); j++) {
             sum += arr[j].value;
             count++;
           }
           return { ...d, value: sum / count };
        });

        const avgEnergy = smoothedData.reduce((acc, curr) => acc + curr.value, 0) / smoothedData.length;
        const peakThreshold = avgEnergy * (1 + (config.sensitivity / 50)); 

        const peaks: {time: number, value: number, index: number}[] = [];
        for(let i = 1; i < smoothedData.length - 1; i++) {
           const prev = smoothedData[i-1].value;
           const curr = smoothedData[i].value;
           const next = smoothedData[i+1].value;
           
           if(curr > prev && curr > next && curr > peakThreshold) {
              peaks.push({ ...smoothedData[i], index: i });
           }
        }

        // 3. ATOMIC LOOP GENERATION
        let atomicLoops: DetectedLoop[] = [];
        for(let i = 0; i < peaks.length - 1; i++) {
            const startPeak = peaks[i];
            const endPeak = peaks[i+1];
            const loopDuration = endPeak.time - startPeak.time;
            
            let hasCut = false;
            if (config.detectSceneChanges) {
                for (let k = startPeak.index; k < endPeak.index; k++) {
                    if (detrendedData[k].isSceneCut) { hasCut = true; break; }
                }
            }

            if (!hasCut && loopDuration >= config.minLoopDuration && loopDuration <= config.maxLoopDuration) {
                const bpm = Math.round(60 / loopDuration);
                // Confidence is now based on our fused Audio/Video score
                const confidence = Math.min(1.0, (startPeak.value + endPeak.value) / (2 * 255) * 5);
                atomicLoops.push({
                    id: `atom-${i}`,
                    startTime: startPeak.time,
                    endTime: endPeak.time,
                    duration: loopDuration,
                    bpm: bpm,
                    confidence: confidence,
                    repCount: 1,
                });
            }
        }

        // 4. FINAL PROCESSING (Merging)
        let finalLoops: DetectedLoop[] = [];
        if (config.detectionMode === 'reps') {
            finalLoops = atomicLoops.map((l, i) => ({
                ...l,
                id: `rep-${Date.now()}-${i}`,
                label: `Repetition ${i+1}`,
            }));
        } else {
            // Sets Logic
            if (atomicLoops.length > 0) {
                let currentSet: DetectedLoop[] = [atomicLoops[0]];
                for (let i = 1; i < atomicLoops.length; i++) {
                    const prev = currentSet[currentSet.length - 1];
                    const curr = atomicLoops[i];
                    const gap = curr.startTime - prev.endTime;
                    const maxGap = Math.max(2.0, prev.duration * 3.0);
                    let gapHasCut = false;
                    if (config.detectSceneChanges) {
                         const startIndex = Math.floor(prev.endTime * fps);
                         const endIndex = Math.ceil(curr.startTime * fps);
                         for(let k = startIndex; k < endIndex && k < detrendedData.length; k++) {
                             if(detrendedData[k].isSceneCut) gapHasCut = true;
                         }
                    }

                    if (gap < maxGap && !gapHasCut) {
                        currentSet.push(curr);
                    } else {
                        finalLoops.push(mergeSet(currentSet));
                        currentSet = [curr];
                    }
                }
                finalLoops.push(mergeSet(currentSet));
            }
        }

        // 5. THUMBNAILS
        const resultLoopsWithThumbs: DetectedLoop[] = [];
        for (let i = 0; i < finalLoops.length; i++) {
            const loop = finalLoops[i];
            const thumbTime = loop.startTime + (loop.duration * 0.5); 
            
            await new Promise<void>(resolve => {
                const h = () => resolve();
                video.addEventListener('seeked', h, { once: true });
                video.currentTime = thumbTime;
            });
            
            canvas.width = 160; 
            canvas.height = 90;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const thumb = canvas.toDataURL('image/jpeg', 0.6);
            resultLoopsWithThumbs.push({ ...loop, thumbnail: thumb });
        }

        onLoopsDetected(resultLoopsWithThumbs);
        addLog('success', `Analysis Complete. Found ${resultLoopsWithThumbs.length} items.`);
        setAppState(AppState.READY);
        video.currentTime = 0; 

    } catch (err) {
        console.error(err);
        addLog('error', `Analysis failed: ${err}`);
        setAppState(AppState.READY);
    }

  }, [config, setAppState, addLog, onLoopsDetected, onProgress, onMotionDataUpdate, file]);

  const mergeSet = (loops: DetectedLoop[]): DetectedLoop => {
      const first = loops[0];
      const last = loops[loops.length - 1];
      const totalDuration = last.endTime - first.startTime;
      const avgBpm = loops.reduce((acc, l) => acc + l.bpm, 0) / loops.length;
      const avgConf = loops.reduce((acc, l) => acc + l.confidence, 0) / loops.length;
      
      return {
          id: `set-${Date.now()}-${first.startTime}`,
          startTime: first.startTime,
          endTime: last.endTime,
          duration: totalDuration,
          bpm: Math.round(avgBpm),
          confidence: avgConf,
          repCount: loops.length,
          label: `Set of ${loops.length} Reps`
      };
  };

  return (
    <>
        {/* Sentinel for Scroll Detection */}
        <div ref={sentinelRef} className="absolute top-0 w-full h-full pointer-events-none -z-10" />

        <div ref={containerRef} className={`relative transition-all duration-300 ease-in-out ${
            isPip 
            ? 'fixed bottom-6 right-6 w-80 aspect-video z-50 shadow-2xl ring-2 ring-emerald-500/50 rounded-lg animate-in slide-in-from-bottom-10 fade-in' 
            : 'w-full aspect-video rounded-xl shadow-2xl border border-slate-700'
        } bg-black overflow-hidden group`}>
        
        {videoUrl ? (
            <>
            <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
            />
            
            {/* Custom Overlay Controls */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="flex items-center gap-4">
                    <button 
                    onClick={togglePlay} 
                    className="text-white hover:text-emerald-400 active:scale-90 transition transform"
                    >
                    {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                    </button>
                    
                    {/* Progress Bar */}
                    <div className="flex-1 h-1 bg-slate-700 rounded-full cursor-pointer relative group/timeline">
                    <div 
                        className="absolute top-0 left-0 h-full bg-emerald-500 rounded-full" 
                        style={{ width: `${(currentTime / duration) * 100}%` }} 
                    />
                    </div>
                    
                    <div className="text-xs font-mono text-slate-300">
                    {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
                    </div>
                    
                    {/* Analyze Button - Only show when NOT in PiP or small mode */}
                    {!isPip && appState === AppState.READY && (
                        <button 
                            onClick={startAnalysis}
                            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 active:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-sm font-semibold transition shadow-lg hover:shadow-emerald-500/20"
                        >
                            <Activity size={16} />
                            Analyze
                        </button>
                    )}
                    
                    {isPip && (
                        <div className="flex items-center text-xs text-emerald-400 font-bold gap-1">
                            <Minimize2 size={12} /> PiP Mode
                        </div>
                    )}
                </div>
            </div>
            </>
        ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Activity size={48} className="mb-4 opacity-50" />
            <p>No video loaded</p>
            </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
        </div>
    </>
  );
};