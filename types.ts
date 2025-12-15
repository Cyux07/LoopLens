export interface DetectedLoop {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  bpm: number;
  confidence: number;
  repCount: number; // Number of repetitions in this loop/set
  thumbnail?: string; // Base64 image
  label?: string; // User defined or auto-generated label
}

export interface AnalysisConfig {
  sensitivity: number; // 0-100, Peak detection threshold factor
  minLoopDuration: number; // seconds
  maxLoopDuration: number; // seconds
  samplingRate: number; // FPS (Analysis speed vs accuracy)
  smoothingWindow: number; // Number of frames to smooth
  detectionMode: 'reps' | 'sets'; // 'reps' = individual loops, 'sets' = continuous sequences
  detectSceneChanges: boolean; // Cut segments on massive visual changes
  ignoreSteadyMotion: boolean; // Use High-Pass filter to ignore panning/steady movement
  audioWeight: number; // 0-100, How much audio influences the detection (0 = video only, 100 = audio only)
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface VideoFile {
  id: string;
  file: File;
  status: 'pending' | 'analyzed' | 'error';
  loopsFound: number;
}

export enum AppState {
  IDLE = 'IDLE',
  LOADING_VIDEO = 'LOADING_VIDEO',
  ANALYZING = 'ANALYZING',
  READY = 'READY',
}