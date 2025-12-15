import React, { useState, useCallback, useRef, useMemo } from 'react';
import { VideoAnalyzer } from './components/VideoAnalyzer';
import { ConsolePanel } from './components/ConsolePanel';
import { DetectedLoop, AnalysisConfig, LogEntry, AppState, VideoFile } from './types';
import { 
  Settings, Upload, Film, Download, 
  BarChart2, RefreshCcw, Terminal, Loader2, FolderOpen, Play, CheckCircle, HelpCircle, Layers, Repeat, Zap, Scissors, Trash2, ArrowUpDown, FileText, Music
} from 'lucide-react';
import { 
  Tooltip as ReTooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';

// --- COMPONENTS ---

// Tooltip Helper
const TooltipHelp: React.FC<{text: string}> = ({text}) => (
  <div className="group relative inline-block ml-1">
    <HelpCircle size={12} className="text-slate-500 cursor-help hover:text-emerald-400" />
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-slate-800 text-xs text-slate-200 rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition z-50 border border-slate-700">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
    </div>
  </div>
);

type SortOption = 'startTime' | 'repCount' | 'duration' | 'confidence' | 'bpm';

const App: React.FC = () => {
  // State
  const [playlist, setPlaylist] = useState<VideoFile[]>([]);
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);
  
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loops, setLoops] = useState<DetectedLoop[]>([]);
  const [progress, setProgress] = useState(0);
  const [motionData, setMotionData] = useState<{time: number, value: number}[]>([]);
  const [selectedLoopId, setSelectedLoopId] = useState<string | null>(null);
  const [hoveredLoop, setHoveredLoop] = useState<DetectedLoop | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  // Sorting State
  const [sortBy, setSortBy] = useState<SortOption>('startTime');
  const [sortAsc, setSortAsc] = useState(true);

  const [config, setConfig] = useState<AnalysisConfig>({
    sensitivity: 40,
    minLoopDuration: 0.5,
    maxLoopDuration: 5.0,
    samplingRate: 10,
    smoothingWindow: 2,
    detectionMode: 'sets',
    detectSceneChanges: true,
    ignoreSteadyMotion: true,
    audioWeight: 20 // Default 20% audio influence
  });

  const folderInputRef = useRef<HTMLInputElement>(null);

  // Helper: Logger
  const addLog = useCallback((level: LogEntry['level'], message: string) => {
    setLogs(prev => [...prev, { id: Math.random().toString(), timestamp: new Date(), level, message }]);
  }, []);

  // Handler: Single File
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const newFile: VideoFile = {
        id: Math.random().toString(36).substr(2, 9),
        file: e.target.files[0],
        status: 'pending',
        loopsFound: 0
      };
      setPlaylist([newFile]);
      setCurrentVideoId(newFile.id);
      addLog('info', 'File loaded.');
    }
  };

  // Handler: Folder Upload
  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const videoExtensions = ['.mp4', '.mov', '.webm', '.mkv', '.avi'];
      const newFiles: VideoFile[] = [];
      
      Array.from(e.target.files).forEach(file => {
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
        if (videoExtensions.includes(ext)) {
           newFiles.push({
             id: Math.random().toString(36).substr(2, 9),
             file: file,
             status: 'pending',
             loopsFound: 0
           });
        }
      });

      if (newFiles.length > 0) {
        setPlaylist(prev => [...prev, ...newFiles]);
        if (!currentVideoId) setCurrentVideoId(newFiles[0].id);
        addLog('info', `Added ${newFiles.length} videos from folder.`);
      } else {
        addLog('warn', 'No valid video files found in folder.');
      }
    }
  };

  // Handler: Remove Loop
  const handleRemoveLoop = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setLoops(prev => prev.filter(l => l.id !== id));
      if (selectedLoopId === id) setSelectedLoopId(null);
  };

  // Handler: Export Batch Script
  const generateExportCommand = () => {
    const activeVideo = playlist.find(v => v.id === currentVideoId);
    if (!activeVideo) return '';
    
    let cmd = `# Batch export script for ${activeVideo.file.name}\n`;
    cmd += `# Note: Using re-encoding (libx264) instead of copy to ensure short clips (<1s) are valid.\n`;
    cmd += `mkdir "exported_loops"\n\n`;
    
    // Use sorted loops for export
    sortedLoops.forEach((loop, idx) => {
       const safeName = `loop_${idx + 1}_${activeVideo.file.name.replace(/\.[^/.]+$/, "")}.mp4`;
       cmd += `ffmpeg -ss ${loop.startTime.toFixed(3)} -to ${loop.endTime.toFixed(3)} -i "${activeVideo.file.name}" -c:v libx264 -c:a aac -preset veryfast -crf 23 "exported_loops/${safeName}"\n`;
    });
    return cmd;
  };

  // Handler: Export CSV
  const handleExportCSV = () => {
     const activeVideo = playlist.find(v => v.id === currentVideoId);
     if (!activeVideo) return;

     const headers = ['Source File', 'Output Filename', 'Start Time (s)', 'End Time (s)', 'Duration (s)', 'BPM', 'Rep Count', 'Confidence'];
     const rows = sortedLoops.map((loop, idx) => {
        const safeName = `loop_${idx + 1}_${activeVideo.file.name.replace(/\.[^/.]+$/, "")}.mp4`;
        const fullPath = `exported_loops/${safeName}`; // Relative path as per script
        return [
           activeVideo.file.name,
           fullPath,
           loop.startTime.toFixed(3),
           loop.endTime.toFixed(3),
           loop.duration.toFixed(3),
           loop.bpm,
           loop.repCount,
           (loop.confidence * 100).toFixed(0) + '%'
        ];
     });

     const csvContent = [
        headers.join(','),
        ...rows.map(r => r.join(','))
     ].join('\n');

     const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
     const url = URL.createObjectURL(blob);
     const link = document.createElement('a');
     link.href = url;
     link.setAttribute('download', `${activeVideo.file.name}_analysis.csv`);
     document.body.appendChild(link);
     link.click();
     document.body.removeChild(link);
     addLog('success', 'CSV exported successfully.');
  };

  const handleModalBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setIsExportModalOpen(false);
    }
  };

  const isBlocking = appState === AppState.ANALYZING || appState === AppState.LOADING_VIDEO;
  const activeVideo = playlist.find(v => v.id === currentVideoId);

  // Sorting Logic
  const sortedLoops = useMemo(() => {
      const sorted = [...loops].sort((a, b) => {
          let valA = a[sortBy];
          let valB = b[sortBy];
          if (valA < valB) return sortAsc ? -1 : 1;
          if (valA > valB) return sortAsc ? 1 : -1;
          return 0;
      });
      return sorted;
  }, [loops, sortBy, sortAsc]);

  const toggleSort = (field: SortOption) => {
      if (sortBy === field) {
          setSortAsc(!sortAsc);
      } else {
          setSortBy(field);
          setSortAsc(true); // Default asc for new field
      }
  };

  return (
    <div className="flex h-screen w-full bg-slate-950 text-slate-200 overflow-hidden font-sans relative">
      
      {/* BLOCKING OVERLAY */}
      {isBlocking && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl flex flex-col items-center max-w-sm w-full">
             <Loader2 size={48} className="text-emerald-400 animate-spin mb-4" />
             <h2 className="text-xl font-bold text-white mb-2">
               {appState === AppState.LOADING_VIDEO ? 'Loading Media...' : 'Analyzing Footage...'}
             </h2>
             <p className="text-slate-400 text-sm text-center mb-6">
               {appState === AppState.LOADING_VIDEO 
                 ? 'Reading file metadata and initializing decoder.' 
                 : `Scanning frames at ${config.samplingRate} FPS...`}
             </p>
             
             {appState === AppState.ANALYZING && (
               <div className="w-full space-y-2">
                 <div className="flex justify-between text-xs text-slate-400">
                    <span>Progress</span>
                    <span>{progress.toFixed(0)}%</span>
                 </div>
                 <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-full transition-all duration-100 ease-linear shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                      style={{ width: `${progress}%` }}
                    />
                 </div>
               </div>
             )}
          </div>
        </div>
      )}

      {/* LEFT SIDEBAR */}
      <div className="w-80 bg-slate-900 border-r border-slate-800 flex flex-col z-20 shadow-xl flex-shrink-0">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent flex items-center gap-2">
            <RefreshCcw className="text-emerald-400" />
            LoopLens
          </h1>
          <p className="text-xs text-slate-500 mt-2">Offline Video Analyzer</p>
        </div>

        <div className="p-6 flex-1 overflow-y-auto space-y-8 scrollbar-thin">
          
          {/* File Input */}
          <div className="space-y-3">
             <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Inputs</label>
             <div className="grid grid-cols-2 gap-2">
                <div className="relative group active:scale-95 transition-transform">
                    <input 
                      type="file" 
                      accept="video/*" 
                      onChange={handleFileUpload} 
                      disabled={isBlocking}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="border border-slate-700 hover:border-emerald-500/50 rounded-lg p-3 text-center bg-slate-800/50 flex flex-col items-center gap-1">
                      <Upload size={20} className="text-slate-400" />
                      <span className="text-[10px] font-bold text-slate-300">FILE</span>
                    </div>
                </div>
                
                <div className="relative group active:scale-95 transition-transform">
                   <input
                        type="file"
                        // @ts-ignore
                        webkitdirectory="" 
                        directory=""
                        multiple
                        ref={folderInputRef}
                        onChange={handleFolderUpload}
                        disabled={isBlocking}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="border border-slate-700 hover:border-emerald-500/50 rounded-lg p-3 text-center bg-slate-800/50 flex flex-col items-center gap-1">
                      <FolderOpen size={20} className="text-slate-400" />
                      <span className="text-[10px] font-bold text-slate-300">FOLDER</span>
                    </div>
                </div>
             </div>
          </div>

          {/* Playlist */}
          {playlist.length > 0 && (
             <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">Playlist ({playlist.length})</label>
                {playlist.map(v => (
                   <div 
                     key={v.id} 
                     onClick={() => !isBlocking && setCurrentVideoId(v.id)}
                     className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer border ${
                        currentVideoId === v.id 
                        ? 'bg-emerald-900/20 border-emerald-500/50 text-emerald-300' 
                        : 'bg-slate-800/30 border-slate-800 text-slate-400 hover:bg-slate-800'
                     }`}
                   >
                     <span className="truncate w-32" title={v.file.name}>{v.file.name}</span>
                     {v.id === currentVideoId && <Play size={10} className="fill-current" />}
                   </div>
                ))}
             </div>
          )}

          {/* Settings */}
          <div className={`space-y-6 transition-opacity ${isBlocking ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <Settings size={14} /> Analysis Config
              </label>
            </div>

            {/* Mode Selection */}
            <div className="space-y-3 bg-slate-800/50 p-3 rounded-lg border border-slate-700">
               <span className="text-[10px] uppercase font-bold text-slate-400 block mb-2">Detection Mode</span>
               <div className="flex gap-2">
                  <button 
                    onClick={() => setConfig({...config, detectionMode: 'reps'})}
                    className={`flex-1 flex flex-col items-center justify-center p-2 rounded text-xs transition ${
                       config.detectionMode === 'reps' 
                       ? 'bg-emerald-600 text-white shadow-lg' 
                       : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                     <Repeat size={16} className="mb-1" />
                     Single Reps
                  </button>
                  <button 
                    onClick={() => setConfig({...config, detectionMode: 'sets'})}
                    className={`flex-1 flex flex-col items-center justify-center p-2 rounded text-xs transition ${
                       config.detectionMode === 'sets' 
                       ? 'bg-emerald-600 text-white shadow-lg' 
                       : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                     <Layers size={16} className="mb-1" />
                     Continuous Sets
                  </button>
               </div>
            </div>
            
            {/* Algorithm Toggles */}
            <div className="space-y-3">
               <label className="flex items-center justify-between text-xs cursor-pointer group">
                  <span className="flex items-center text-slate-400 group-hover:text-slate-200 transition">
                     <Zap size={14} className="mr-2" />
                     Ignore Steady Motion
                     <TooltipHelp text="Ignores constant movement (like panning/zooming) and focuses only on oscillating/repetitive actions." />
                  </span>
                  <input 
                     type="checkbox" 
                     checked={config.ignoreSteadyMotion}
                     onChange={(e) => setConfig({...config, ignoreSteadyMotion: e.target.checked})}
                     className="accent-emerald-500"
                  />
               </label>
               <label className="flex items-center justify-between text-xs cursor-pointer group">
                  <span className="flex items-center text-slate-400 group-hover:text-slate-200 transition">
                     <Scissors size={14} className="mr-2" />
                     Detect Scene Cuts
                     <TooltipHelp text="Prevents segments from spanning across different camera shots." />
                  </span>
                  <input 
                     type="checkbox" 
                     checked={config.detectSceneChanges}
                     onChange={(e) => setConfig({...config, detectSceneChanges: e.target.checked})}
                     className="accent-emerald-500"
                  />
               </label>
            </div>

            {/* Audio Weight */}
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="flex items-center">
                    <Music size={12} className="mr-1" /> 
                    Audio vs Video
                    <TooltipHelp text="0% = Video Only. 50% = Equal. 100% = Audio Peaks Only." />
                </span>
                <span className="text-emerald-400">{config.audioWeight}% Audio</span>
              </div>
              <input 
                type="range" 
                min="0" max="100" step="5"
                value={config.audioWeight}
                onChange={(e) => setConfig({...config, audioWeight: parseInt(e.target.value)})}
                className="w-full accent-emerald-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Sampling Rate */}
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="flex items-center">Speed (FPS) <TooltipHelp text="Higher = More Precise. Lower = Faster Analysis." /></span>
                <span className="text-emerald-400">{config.samplingRate} fps</span>
              </div>
              <input 
                type="range" 
                min="2" max="30" step="1"
                value={config.samplingRate}
                onChange={(e) => setConfig({...config, samplingRate: parseInt(e.target.value)})}
                className="w-full accent-emerald-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Sensitivity */}
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <span className="flex items-center">Sensitivity <TooltipHelp text="Peak Detection Threshold. Higher = detects more subtle motion. Lower = ignores noise." /></span>
                <span className="text-emerald-400">{config.sensitivity}%</span>
              </div>
              <input 
                type="range" 
                min="1" max="100" 
                value={config.sensitivity}
                onChange={(e) => setConfig({...config, sensitivity: parseInt(e.target.value)})}
                className="w-full accent-emerald-500 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Durations */}
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <span className="text-[10px] uppercase text-slate-500 flex">Min Rep Sec <TooltipHelp text="Minimum duration of a single repetition to be counted" /></span>
                    <input 
                        type="number" 
                        value={config.minLoopDuration}
                        onChange={(e) => setConfig({...config, minLoopDuration: parseFloat(e.target.value)})}
                        step="0.1"
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400"
                    />
                </div>
                <div className="space-y-2">
                    <span className="text-[10px] uppercase text-slate-500 flex">Max Rep Sec <TooltipHelp text="Maximum duration of a single repetition" /></span>
                    <input 
                        type="number" 
                        value={config.maxLoopDuration}
                        onChange={(e) => setConfig({...config, maxLoopDuration: parseFloat(e.target.value)})}
                        step="0.1"
                        className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-emerald-400"
                    />
                </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 space-y-2">
           <button 
             onClick={() => setIsExportModalOpen(true)}
             disabled={loops.length === 0 || isBlocking}
             className="w-full py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-slate-200 rounded-lg font-medium transition active:scale-95 flex items-center justify-center gap-2"
           >
             <Terminal size={16} />
             Get FFmpeg Script
           </button>
           <button 
             onClick={handleExportCSV}
             disabled={loops.length === 0 || isBlocking}
             className="w-full py-2 bg-emerald-900/30 hover:bg-emerald-900/50 border border-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-emerald-400 rounded-lg font-medium transition active:scale-95 flex items-center justify-center gap-2 text-xs"
           >
             <FileText size={14} />
             Export CSV Info
           </button>
        </div>
      </div>

      {/* CENTER: WORKSPACE */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
        
        {/* Main Viewport */}
        <div className="flex-1 p-6 overflow-y-auto">
           <div className="max-w-5xl mx-auto space-y-6">
              
              {/* Video Player */}
              <div className="bg-slate-900 rounded-2xl p-1 shadow-2xl ring-1 ring-slate-800">
                <VideoAnalyzer 
                  file={activeVideo ? activeVideo.file : null}
                  config={config}
                  appState={appState}
                  setAppState={setAppState}
                  addLog={addLog}
                  onLoopsDetected={setLoops}
                  onProgress={setProgress}
                  onMotionDataUpdate={setMotionData}
                  previewLoop={hoveredLoop} // Pass hovered loop for preview
                />
              </div>

              {/* Visualization: Motion Graph */}
              {motionData.length > 0 && !isBlocking && (
                <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-800 backdrop-blur-sm animate-fadeIn">
                   <div className="flex items-center gap-2 mb-4 text-sm font-semibold text-slate-400">
                      <BarChart2 size={16} />
                      Motion Rhythm
                   </div>
                   <div className="h-32 w-full">
                     <ResponsiveContainer width="100%" height="100%">
                       <AreaChart data={motionData}>
                         <defs>
                           <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                             <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                             <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                           </linearGradient>
                         </defs>
                         <ReTooltip 
                            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                            itemStyle={{ color: '#10b981' }}
                         />
                         <Area 
                           type="monotone" 
                           dataKey="value" 
                           stroke="#10b981" 
                           fillOpacity={1} 
                           fill="url(#colorValue)" 
                           isAnimationActive={false}
                         />
                       </AreaChart>
                     </ResponsiveContainer>
                   </div>
                </div>
              )}

              {/* Results Grid */}
              {loops.length > 0 && !isBlocking && (
                <div className="space-y-4 animate-fadeIn">
                  <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <Film size={20} className="text-emerald-400" />
                        Detected {config.detectionMode === 'sets' ? 'Sets' : 'Reps'}
                        <span className="text-sm font-normal text-slate-500 ml-2">({loops.length})</span>
                      </h3>
                      
                      {/* Sorting Controls */}
                      <div className="flex items-center gap-2">
                         <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Sort By:</span>
                         <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
                            {[
                                { id: 'startTime', label: 'Time' },
                                { id: 'repCount', label: 'Reps' },
                                { id: 'duration', label: 'Length' },
                                { id: 'confidence', label: 'Match' }
                            ].map(opt => (
                                <button
                                    key={opt.id}
                                    onClick={() => toggleSort(opt.id as SortOption)}
                                    className={`px-3 py-1 text-xs rounded transition flex items-center gap-1 ${
                                        sortBy === opt.id 
                                        ? 'bg-slate-700 text-white' 
                                        : 'text-slate-400 hover:text-slate-300'
                                    }`}
                                >
                                    {opt.label}
                                    {sortBy === opt.id && <ArrowUpDown size={10} className={sortAsc ? 'opacity-50' : 'rotate-180 opacity-50'} />}
                                </button>
                            ))}
                         </div>
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sortedLoops.map(loop => (
                      <div 
                        key={loop.id}
                        className={`bg-slate-900 border rounded-xl overflow-hidden transition-all hover:shadow-lg group active:scale-[0.98] cursor-pointer relative ${
                          selectedLoopId === loop.id ? 'border-emerald-500 ring-1 ring-emerald-500/50' : 'border-slate-800 hover:border-emerald-500/30'
                        }`}
                        onClick={() => setSelectedLoopId(loop.id)}
                        onMouseEnter={() => setHoveredLoop(loop)}
                        onMouseLeave={() => setHoveredLoop(null)}
                      >
                        {/* Remove Button */}
                        <button 
                            onClick={(e) => handleRemoveLoop(e, loop.id)}
                            className="absolute top-2 right-2 z-20 bg-black/60 hover:bg-red-500/80 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition duration-200"
                            title="Remove result"
                        >
                            <Trash2 size={12} />
                        </button>

                        <div className="relative aspect-video bg-black">
                           {loop.thumbnail && (
                             <img src={loop.thumbnail} alt="Loop Thumb" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" />
                           )}
                           <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-md px-2 py-1 rounded text-xs font-mono font-bold text-emerald-400 border border-white/10">
                              {loop.repCount} {config.detectionMode === 'sets' ? 'Reps' : 'X'}
                           </div>
                           <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md px-2 py-1 rounded text-xs text-white border border-white/10">
                              ~{loop.bpm} BPM
                           </div>
                        </div>
                        
                        <div className="p-3">
                           <div className="flex justify-between items-center text-xs text-slate-500 font-mono mb-1">
                              <span>{loop.startTime.toFixed(1)}s - {loop.endTime.toFixed(1)}s</span>
                              <span>{loop.duration.toFixed(1)}s</span>
                           </div>
                           <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-400 font-semibold">{loop.label}</span>
                              <span className="flex items-center gap-1 text-emerald-500/80">
                                <CheckCircle size={10} /> {(loop.confidence * 100).toFixed(0)}%
                              </span>
                           </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
           </div>
        </div>

        {/* BOTTOM: CONSOLE LOG */}
        <div className="h-48 border-t border-slate-800 bg-slate-900 z-10">
           <ConsolePanel logs={logs} />
        </div>
      </div>

      {/* MODAL: Export - UPDATED STRUCTURE */}
      {isExportModalOpen && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-fadeIn"
          onClick={handleModalBackdropClick}
        >
           <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
              <div className="p-6 border-b border-slate-800">
                <h2 className="text-xl font-bold flex items-center gap-2">
                   <Terminal size={24} className="text-emerald-400" />
                   Batch Export Script
                </h2>
                <p className="text-slate-400 text-sm mt-1">
                   Run this script in your terminal to save clips. We use re-encoding to ensure short clips play correctly.
                </p>
              </div>
              
              <div className="flex-1 p-6 overflow-hidden flex flex-col">
                  <div className="bg-slate-950 rounded-lg p-4 font-mono text-xs text-slate-300 border border-slate-800 relative group flex-1 overflow-y-auto max-h-[50vh]">
                     <pre className="whitespace-pre-wrap break-all">{generateExportCommand()}</pre>
                     <button 
                        onClick={() => {
                           navigator.clipboard.writeText(generateExportCommand());
                           addLog('success', 'Export script copied to clipboard');
                        }}
                        className="absolute top-2 right-2 bg-slate-800 hover:bg-slate-700 text-white px-3 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition active:scale-95 border border-slate-700 sticky"
                     >
                        Copy
                     </button>
                  </div>
              </div>

              <div className="p-6 border-t border-slate-800 bg-slate-900 flex justify-end gap-3">
                 <button 
                   onClick={() => setIsExportModalOpen(false)}
                   className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition active:scale-95"
                 >
                   Close
                 </button>
              </div>
           </div>
        </div>
      )}

    </div>
  );
};

export default App;