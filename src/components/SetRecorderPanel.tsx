import React, { useState } from 'react';
import { Radio, Download, Disc, CheckCircle } from 'lucide-react';
import { AudioEngine } from '../audio/audioEngine.js';
import { formatTime } from '../utils/audioMath.js';

interface SetRecorderPanelProps {
  engine: AudioEngine;
}

export const SetRecorderPanel: React.FC<SetRecorderPanelProps> = ({ engine }) => {
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const master = engine.masterState;

  const handleStartRecording = () => {
    setRecordedBlob(null);
    setDownloadUrl(null);
    engine.startRecording();
  };

  const handleStopRecording = () => {
    const blob = engine.stopRecording();
    if (blob) {
      setRecordedBlob(blob);
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
    }
  };

  return (
    <div className="flex flex-col bg-[#0a0d16] rounded-2xl border border-slate-800 p-4 shadow-xl">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-400">
            <Radio className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">Live Master Set Recorder</h3>
            <p className="text-xs text-slate-400">Capture your live mix directly from the master bus</p>
          </div>
        </div>

        {master.isRecording && (
          <div className="flex items-center gap-2 bg-rose-950/80 border border-rose-800 px-3 py-1 rounded-full text-rose-400 text-xs font-bold animate-pulse">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>RECORDING LIVE</span>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center justify-center p-6 my-2 bg-[#090b14] rounded-xl border border-slate-800">
        {/* Time Elapsed */}
        <span className="text-3xl sm:text-4xl font-extrabold font-mono-numbers text-white tracking-wider my-2">
          {formatTime(master.recordingDuration)}
        </span>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 mt-4">
          {!master.isRecording ? (
            <button
              onClick={handleStartRecording}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-lg shadow-rose-900/30 transition active:scale-95"
            >
              <Radio className="w-4 h-4" />
              <span>Start Recording</span>
            </button>
          ) : (
            <button
              onClick={handleStopRecording}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 font-bold text-sm shadow-lg transition active:scale-95"
            >
              <Disc className="w-4 h-4 text-rose-400 animate-spin" />
              <span>Stop & Save Mix</span>
            </button>
          )}

          {downloadUrl && (
            <a
              href={downloadUrl}
              download={`ogopa-djs-live-set-${new Date().toISOString().slice(0, 10)}.webm`}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg shadow-emerald-900/30 transition active:scale-95"
            >
              <Download className="w-4 h-4" />
              <span>Download Audio File</span>
            </a>
          )}
        </div>

        {downloadUrl && (
          <div className="flex items-center gap-2 mt-4 text-xs text-emerald-400 font-medium">
            <CheckCircle className="w-4 h-4" />
            <span>Mix ready! Saved at full master resolution.</span>
          </div>
        )}
      </div>
    </div>
  );
};
