import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AudioEngine } from './audio/audioEngine.js';
import { Header } from './components/Header.js';
import { Deck } from './components/Deck.js';
import { Mixer } from './components/Mixer.js';
import { CrateLibrary } from './components/CrateLibrary.js';
import { SamplerPanel } from './components/SamplerPanel.js';
import { StemsAndFxPanel } from './components/StemsAndFxPanel.js';
import { SetRecorderPanel } from './components/SetRecorderPanel.js';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal.js';
import { PowerOverlay } from './components/PowerOverlay.js';
import { OfflineIndicator } from './components/OfflineIndicator.js';
import { DEMO_TRACK_METADATA, synthesizeDemoTrack } from './audio/demoTracks.js';
import { DJTrack } from './utils/crateLogic.js';
import { getAllTracksFromDb, resolveAudioBufferForTrack, saveTrackWithBlob, audioBufferCache } from './db/libraryDb.js';
import { analyzeAudioBuffer } from './audio/analyzer.js';

export default function App() {
  const engineRef = useRef<AudioEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [isPoweredOn, setIsPoweredOn] = useState(false);
  const [activeTab, setActiveTab] = useState<'mixer' | 'crate' | 'sampler' | 'stems' | 'recorder'>('mixer');
  const [mobileActiveDeck, setMobileActiveDeck] = useState<'A' | 'B'>('A');
  const [targetDeckToLoad, setTargetDeckToLoad] = useState<'A' | 'B' | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [tracks, setTracks] = useState<DJTrack[]>([]);
  const [, setTick] = useState(0);

  // Initialize AudioEngine once
  useEffect(() => {
    const engine = AudioEngine.getInstance();
    engineRef.current = engine;

    // Build initial library from Demo Tracks + DB
    const initialTracks: DJTrack[] = DEMO_TRACK_METADATA.map((d) => ({
      id: d.id,
      title: d.title,
      artist: d.artist,
      duration: d.duration,
      bpm: d.bpm,
      key: d.key,
      camelot: d.camelot,
      genre: d.genre,
      crateId: d.genre.toLowerCase(),
      rating: 5,
      isDemo: true,
      isFavorite: d.id === 'demo-1' || d.id === 'demo-3',
    }));

    getAllTracksFromDb().then((dbTracks) => {
      const merged = [...initialTracks, ...dbTracks.filter((t) => !initialTracks.some((it) => it.id === t.id))];
      setTracks(merged);
    });

    // Check for autostart query parameter (for testing or automated audits)
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      engine.powerOn().then(() => {
        engine.loadDefaultDemos();
        setIsPoweredOn(true);
      });
    }

    setEngineReady(true);
  }, []);

  // 60fps tick for real-time waveform needle, timecodes, and VU meters
  useEffect(() => {
    let animId: number;
    let lastRenderTime = 0;

    const loop = (now: number) => {
      if (engineRef.current && isPoweredOn) {
        engineRef.current.tick();
        // Throttle React state render to ~30-40fps for high performance
        if (now - lastRenderTime >= 28) {
          lastRenderTime = now;
          setTick((t) => (t + 1) % 1000);
        }
      }
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPoweredOn]);

  const handlePowerOn = useCallback(async () => {
    if (!engineRef.current) return;
    await engineRef.current.powerOn();
    if (!engineRef.current.deckA.state.track) {
      engineRef.current.loadDefaultDemos();
    }
    setIsPoweredOn(true);
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const engine = engineRef.current;
      if (!engine || !isPoweredOn) return;

      const key = e.key.toLowerCase();

      // Deck A: Play/Pause (a), Cue (s), Nudge (q, w), Hot cues (1-4)
      if (key === 'a') {
        engine.deckA.state.isPlaying ? engine.deckA.pause() : engine.deckA.play();
      } else if (key === 's') {
        engine.deckA.cue();
      } else if (key === 'q') {
        engine.deckA.nudge('down');
      } else if (key === 'w') {
        engine.deckA.nudge('up');
      } else if (['1', '2', '3', '4'].includes(key)) {
        engine.deckA.triggerHotCue(parseInt(key, 10));
      }

      // Deck B: Play/Pause (l), Cue (k), Nudge (o, p), Hot cues (7, 8, 9, 0)
      else if (key === 'l') {
        engine.deckB.state.isPlaying ? engine.deckB.pause() : engine.deckB.play();
      } else if (key === 'k') {
        engine.deckB.cue();
      } else if (key === 'o') {
        engine.deckB.nudge('down');
      } else if (key === 'p') {
        engine.deckB.nudge('up');
      } else if (['7', '8', '9', '0'].includes(key)) {
        const idx = key === '0' ? 4 : parseInt(key, 10) - 6;
        engine.deckB.triggerHotCue(idx);
      }

      // Crossfader: z (left), x (center), c (right)
      else if (key === 'z') {
        engine.setCrossfader(-1);
      } else if (key === 'x') {
        engine.setCrossfader(0);
      } else if (key === 'c') {
        engine.setCrossfader(1);
      }

      // Automix: Space
      else if (e.code === 'Space') {
        e.preventDefault();
        engine.triggerAutomix();
      }

      // Help Modal: ?
      else if (key === '?' || key === '/') {
        setShowShortcuts((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPoweredOn]);

  // Load a track from crate into Deck A or B
  const handleLoadTrack = useCallback(
    async (deckId: 'A' | 'B', track: DJTrack, buffer?: AudioBuffer) => {
      const engine = engineRef.current;
      if (!engine) return;

      if (!isPoweredOn) {
        await handlePowerOn();
      }

      const targetChannel = deckId === 'A' ? engine.deckA : engine.deckB;
      const resolvedBuffer = await resolveAudioBufferForTrack(track, engine.ctx, buffer);

      if (resolvedBuffer) {
        targetChannel.loadTrack(track, resolvedBuffer);
      } else {
        console.warn('Could not resolve audio buffer for', track.title);
      }

      setTargetDeckToLoad(null);
      setActiveTab('mixer');
    },
    [isPoweredOn, handlePowerOn]
  );

  const handleTrackImported = useCallback((track: DJTrack, buffer: AudioBuffer) => {
    setTracks((prev) => [track, ...prev.filter((t) => t.id !== track.id)]);
    audioBufferCache.set(track.id, buffer);
  }, []);

  const handleTrackDeleted = useCallback((trackId: string) => {
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
  }, []);

  // Handle direct file drop or selection on a specific deck
  const handleDirectFileSelect = useCallback(
    async (deckId: 'A' | 'B', file: File) => {
      const engine = engineRef.current;
      if (!engine) return;

      if (!isPoweredOn) {
        await handlePowerOn();
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await engine.ctx.decodeAudioData(arrayBuffer);
        const analysis = await analyzeAudioBuffer(audioBuffer);

        const newTrack: DJTrack = {
          id: `imported-${Date.now()}`,
          title: file.name.replace(/\.[^/.]+$/, ''),
          artist: 'Local Import',
          duration: audioBuffer.duration,
          bpm: analysis.bpm,
          key: analysis.key,
          camelot: analysis.camelot,
          genre: 'Imported',
          crateId: 'imported',
          waveformPeaks: analysis.peaks.overall,
          audioBlob: file,
          rating: 5,
          isFavorite: false,
          isDemo: false,
        };

        audioBufferCache.set(newTrack.id, audioBuffer);
        await saveTrackWithBlob(newTrack, file);
        setTracks((prev) => [newTrack, ...prev.filter((t) => t.id !== newTrack.id)]);

        const targetChannel = deckId === 'A' ? engine.deckA : engine.deckB;
        targetChannel.loadTrack(newTrack, audioBuffer);
      } catch (err) {
        console.error('Failed to load dropped file', err);
      }
    },
    [isPoweredOn, handlePowerOn]
  );

  if (!engineReady || !engineRef.current) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#07090f] text-slate-400 text-sm">
        Initializing Ogopa DJ’s Engine...
      </div>
    );
  }

  const engine = engineRef.current;
  const activeDeckCamelot = engine.deckA.state.track?.camelot || '8A';

  return (
    <div className="min-h-screen flex flex-col bg-[#07090f] text-slate-100">
      {/* Power Overlay (until user clicks Power On or ?autostart=1) */}
      {!isPoweredOn && <PowerOverlay onPowerOn={handlePowerOn} />}

      {/* Top Header compliant with Top Bar Contract */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isPoweredOn={isPoweredOn}
        onTogglePower={handlePowerOn}
        onOpenShortcuts={() => setShowShortcuts(true)}
        isRecording={engine.masterState.isRecording}
      />

      {/* Main DJ Console Viewport */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-2 sm:p-4 flex flex-col gap-4">
        {/* Mobile Deck Switcher (Visible on < 1024px) */}
        <div className="flex lg:hidden items-center justify-center gap-2 bg-[#0c0f1d] p-1.5 rounded-xl border border-slate-800">
          <button
            onClick={() => setMobileActiveDeck('A')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
              mobileActiveDeck === 'A'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Deck A (Cyan)
          </button>
          <button
            onClick={() => setMobileActiveDeck('B')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
              mobileActiveDeck === 'B'
                ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Deck B (Magenta)
          </button>
        </div>

        {/* Dual Deck Console + Hardware Mixer */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4 items-stretch">
          {/* Deck A (Desktop Cols 5, or visible on mobile if active) */}
          <div className={`lg:col-span-5 ${mobileActiveDeck === 'A' ? 'block' : 'hidden lg:block'}`}>
            <Deck
              channel={engine.deckA}
              colorScheme="cyan"
              onSync={() => engine.syncDecks('A')}
              onOpenCrateToLoad={() => {
                setTargetDeckToLoad('A');
                setActiveTab('crate');
              }}
              onDirectFileSelect={handleDirectFileSelect}
            />
          </div>

          {/* Central DJM Mixer (Cols 2 on Desktop, sticky bottom or central on mobile) */}
          <div className="lg:col-span-2">
            <Mixer engine={engine} />
          </div>

          {/* Deck B (Desktop Cols 5, or visible on mobile if active) */}
          <div className={`lg:col-span-5 ${mobileActiveDeck === 'B' ? 'block' : 'hidden lg:block'}`}>
            <Deck
              channel={engine.deckB}
              colorScheme="magenta"
              onSync={() => engine.syncDecks('B')}
              onOpenCrateToLoad={() => {
                setTargetDeckToLoad('B');
                setActiveTab('crate');
              }}
              onDirectFileSelect={handleDirectFileSelect}
            />
          </div>
        </div>

        {/* Contextual Multi-Mode Bottom Drawer */}
        <div className="mt-2">
          {(activeTab === 'mixer' || activeTab === 'crate') && (
            <CrateLibrary
              tracks={tracks}
              onLoadTrack={handleLoadTrack}
              activeDeckCamelot={activeDeckCamelot}
              onTrackImported={handleTrackImported}
              onTrackDeleted={handleTrackDeleted}
              targetDeck={targetDeckToLoad}
              onClearTargetDeck={() => setTargetDeckToLoad(null)}
            />
          )}

          {activeTab === 'sampler' && (
            <SamplerPanel sampler={engine.sampler} />
          )}

          {activeTab === 'stems' && (
            <StemsAndFxPanel engine={engine} />
          )}

          {activeTab === 'recorder' && (
            <SetRecorderPanel engine={engine} />
          )}
        </div>
      </main>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* Offline Status Badge */}
      <OfflineIndicator />
    </div>
  );
}
