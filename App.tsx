import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Emotion, VoiceOption, GeneratedAudio, AppMode, ConversationLine } from './types';
import { VOICES, EMOTION_LABELS, VOICE_LABELS, EMOTION_TAGS } from './constants';
import { generateSpeech, getAudioContext } from './services/geminiService';
import { bufferToWav } from './services/audioUtils';
import { Waveform } from './components/Waveform';
import { Mic, Play, Loader2, Sparkles, Trash2, Globe, Users, User, ArrowLeft, ArrowRight, X, MessageSquare, FileText, List, ArrowUp, Pause, Download, Music, Settings, Key } from 'lucide-react';

// Custom hook for persistent state
function usePersistentState<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(state) : value;
      setState(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (error) {
      console.error(error);
    }
  }, [key, state]);

  return [state, setValue];
}

const MAX_CHARS = 1200; // Limit to ensure WAV file is < 10MB (approx 3.5 mins at 24kHz)

const App: React.FC = () => {
  // --- Persistent State ---
  const [mode, setMode] = usePersistentState<AppMode>('kanjo_mode', 'single');

  // Single Mode Data
  const [singleText, setSingleText] = usePersistentState<string>('kanjo_single_text', "");
  // Default to NEUTRAL, controls removed from UI
  const [selectedEmotion, setSelectedEmotion] = usePersistentState<Emotion>('kanjo_emotion', Emotion.NEUTRAL);
  const [selectedVoiceId, setSelectedVoiceId] = usePersistentState<string>('kanjo_voice_id', VOICES[0].id);
  const [singleDescription, setSingleDescription] = usePersistentState<string>('kanjo_single_desc', "");

  // Conversation Mode Data
  const [convLines, setConvLines] = usePersistentState<ConversationLine[]>('kanjo_conv_lines', []);
  const [speaker1Id, setSpeaker1Id] = usePersistentState<string>('kanjo_spk1_id', VOICES[0].id);
  const [speaker2Id, setSpeaker2Id] = usePersistentState<string>('kanjo_spk2_id', VOICES[1].id);
  const [speaker1Name, setSpeaker1Name] = usePersistentState<string>('kanjo_spk1_name', "Aさん");
  const [speaker2Name, setSpeaker2Name] = usePersistentState<string>('kanjo_spk2_name', "Bさん");
  const [contextDescription, setContextDescription] = usePersistentState<string>('kanjo_context', "");
  const [isScriptMode, setIsScriptMode] = usePersistentState<boolean>('kanjo_script_mode', false);
  const [apiKey, setApiKey] = usePersistentState<string>('kanjo_api_key', "");
  const [remainingCount, setRemainingCount] = usePersistentState<number>('kanjo_remaining', 10);
  const [lastResetDate, setLastResetDate] = usePersistentState<string>('kanjo_last_reset', "");

  // Derived State from IDs
  const selectedVoice = VOICES.find(v => v.id === selectedVoiceId) || VOICES[0];
  const speaker1 = VOICES.find(v => v.id === speaker1Id) || VOICES[0];
  const speaker2 = VOICES.find(v => v.id === speaker2Id) || VOICES[1];

  // Temporary UI State (Not persisted)
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [history, setHistory] = useState<GeneratedAudio[]>([]);

  // Audio Player State
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Input State for adding new lines (Button Mode)
  const [newLineText, setNewLineText] = useState("");
  const [scriptText, setScriptText] = useState("");

  // Audio Refs
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);
  const activeBufferRef = useRef<AudioBuffer | null>(null);
  const animationFrameRef = useRef<number>(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // --- Logic ---

  // Initialize script text when switching modes
  useEffect(() => {
    if (isScriptMode) {
      const text = convLines.map(line => {
        const prefix = line.speaker === 'A' ? 'A' : line.speaker === 'B' ? 'B' : 'A&B';
        return `${prefix}: ${line.text}`;
      }).join('\n');
      setScriptText(text);
    }
  }, [isScriptMode, convLines]);

  // Reset logic: 17:00 JST
  useEffect(() => {
    const checkReset = () => {
      const now = new Date();
      // JST is UTC+9. 17:00 JST is 08:00 UTC.
      // But we can just use local time since the user is in Japan (or wants JST).
      // However, for reliability, let's calculate based on "today's 17:00".

      const today17 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17, 0, 0);

      // We need a unique ID for "this period". 
      // A period starts at 17:00 and ends the next day at 17:00.
      // If currently before 17:00, the "period start" was yesterday 17:00.
      // If currently after 17:00, the "period start" is today 17:00.
      let periodStartStr = "";
      if (now < today17) {
        const yesterday = new Date(today17);
        yesterday.setDate(yesterday.getDate() - 1);
        periodStartStr = yesterday.toISOString().split('T')[0] + " 17:00";
      } else {
        periodStartStr = today17.toISOString().split('T')[0] + " 17:00";
      }

      if (lastResetDate !== periodStartStr) {
        setRemainingCount(10);
        setLastResetDate(periodStartStr);
        console.log("Quota reset to 10 for period starting:", periodStartStr);
      }
    };

    checkReset();
    const timer = setInterval(checkReset, 60000); // Check every minute
    return () => clearInterval(timer);
  }, [lastResetDate, setRemainingCount, setLastResetDate]);

  // Audio Player Logic
  const stopSource = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
        sourceNodeRef.current.disconnect();
      } catch (e) {
        // ignore
      }
      sourceNodeRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  };

  const playAudio = useCallback((id: string, buffer: AudioBuffer, offset = 0) => {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // If switching tracks, reset everything
    if (currentlyPlayingId !== id) {
      stopSource();
      pausedAtRef.current = 0;
      setCurrentlyPlayingId(id);
      activeBufferRef.current = buffer;
      setDuration(buffer.duration);
    } else {
      // Same track, ensure we stop any current source before restarting
      stopSource();
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Start at current context time
    const startAt = ctx.currentTime;
    source.start(startAt, offset);

    sourceNodeRef.current = source;
    startTimeRef.current = startAt - offset;
    setIsPlaying(true);

    source.onended = () => {
      // This fires on stop() too, so we need to check if it reached the end naturally
      const elapsed = getAudioContext().currentTime - startTimeRef.current;
      if (elapsed >= buffer.duration - 0.1) {
        setIsPlaying(false);
        setCurrentTime(0);
        pausedAtRef.current = 0;
      }
    };

    // Animation Loop
    const updateTime = () => {
      const now = getAudioContext().currentTime;
      const cur = now - startTimeRef.current;
      if (cur <= buffer.duration) {
        setCurrentTime(cur);
        animationFrameRef.current = requestAnimationFrame(updateTime);
      }
    };
    updateTime();

  }, [currentlyPlayingId]);

  const handlePause = () => {
    stopSource();
    // Record where we paused
    pausedAtRef.current = getAudioContext().currentTime - startTimeRef.current;
    setIsPlaying(false);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    pausedAtRef.current = newTime;

    if (currentlyPlayingId && activeBufferRef.current) {
      // If currently playing, restart from new time
      if (isPlaying) {
        playAudio(currentlyPlayingId, activeBufferRef.current, newTime);
      }
    }
  };

  const handleDownload = (buffer: AudioBuffer, filename: string) => {
    const blob = bufferToWav(buffer);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTime = (time: number) => {
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ---

  const handleAddLine = (speaker: 'A' | 'B' | 'Both') => {
    if (!newLineText.trim()) return;
    const newLine: ConversationLine = {
      id: Date.now().toString(),
      speaker,
      text: newLineText,
    };
    setConvLines(prev => [...prev, newLine]);
    setNewLineText(""); // Clear input
  };

  const handleDeleteLine = (id: string) => {
    setConvLines(prev => prev.filter(line => line.id !== id));
  };

  const handleInsertTag = (tag: string) => {
    if (isScriptMode) {
      setScriptText(prev => prev + tag);
      return;
    }
    setNewLineText(prev => prev + tag);
    const el = document.getElementById('line-input');
    if (el) el.focus();
  };

  const parseScriptText = (text: string): ConversationLine[] => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      let speaker: 'A' | 'B' | 'Both' = 'A'; // Default
      let content = line.trim();

      if (content.match(/^(A&B|Both|二人|2人)[:：]/i)) {
        speaker = 'Both';
        content = content.replace(/^(A&B|Both|二人|2人)[:：]/i, '').trim();
      } else if (content.match(/^(A|1)[:：]/i) || content.startsWith(`${speaker1Name}:`)) {
        speaker = 'A';
        content = content.replace(/^(A|1)[:：]/i, '').replace(`${speaker1Name}:`, '').trim();
      } else if (content.match(/^(B|2)[:：]/i) || content.startsWith(`${speaker2Name}:`)) {
        speaker = 'B';
        content = content.replace(/^(B|2)[:：]/i, '').replace(`${speaker2Name}:`, '').trim();
      } else if (content) {
        if (content.startsWith(speaker1Name)) {
          speaker = 'A';
          content = content.substring(speaker1Name.length + 1).trim();
        } else if (content.startsWith(speaker2Name)) {
          speaker = 'B';
          content = content.substring(speaker2Name.length + 1).trim();
        }
      }

      if (!content) return null;

      return {
        id: `script-${idx}-${Date.now()}`,
        speaker,
        text: content
      };
    }).filter(Boolean) as ConversationLine[];
  };

  const saveScript = () => {
    const newLines = parseScriptText(scriptText);
    setConvLines(newLines);
    setIsScriptMode(false);
  };

  const handleGenerate = async () => {
    let linesToUse = convLines;
    if (isScriptMode) {
      linesToUse = parseScriptText(scriptText);
    }

    const textToGenerate = mode === 'single'
      ? singleText
      : linesToUse.map(line => {
        if (line.speaker === 'Both') {
          return `${speaker1Name} & ${speaker2Name}: ${line.text}`;
        }
        const name = line.speaker === 'A' ? speaker1Name : speaker2Name;
        return `${name}: ${line.text}`;
      }).join('\n');

    if (!textToGenerate.trim()) return;

    if (textToGenerate.length > MAX_CHARS) {
      alert(`テキストが長すぎます。${MAX_CHARS}文字以内で入力してください。`);
      return;
    }

    if (!apiKey && !process.env.API_KEY) {
      alert("APIキーが設定されていません。画面右上の設定ボタンからAPIキーを入力してください。");
      setShowSettings(true);
      return;
    }

    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
    } catch (e) {
      console.warn("Could not resume AudioContext:", e);
    }

    setIsGenerating(true);

    try {
      const audioBuffer = await generateSpeech({
        mode,
        text: textToGenerate,
        emotion: selectedEmotion,
        voice: selectedVoice,
        speaker1,
        speaker2,
        speaker1Name: mode === 'conversation' ? speaker1Name : undefined,
        speaker2Name: mode === 'conversation' ? speaker2Name : undefined,
        contextDescription: mode === 'conversation' ? contextDescription : singleDescription,
        apiKey: apiKey || undefined,
      });

      const newItem: GeneratedAudio = {
        id: Date.now().toString(),
        text: textToGenerate,
        mode,
        emotion: selectedEmotion,
        voiceName: mode === 'single' ? selectedVoice.name : undefined,
        speaker1: mode === 'conversation' ? speaker1.name : undefined,
        speaker2: mode === 'conversation' ? speaker2.name : undefined,
        speaker1Name: mode === 'conversation' ? speaker1Name : undefined,
        speaker2Name: mode === 'conversation' ? speaker2Name : undefined,
        contextDescription: mode === 'conversation' ? contextDescription : singleDescription,
        timestamp: Date.now(),
        audioBuffer
      };

      setHistory(prev => [newItem, ...prev]);

      // Auto play
      playAudio(newItem.id, newItem.audioBuffer);

      if (isScriptMode) {
        setConvLines(linesToUse);
      }

      // Decrement remaining count
      setRemainingCount(prev => Math.max(0, prev - 1));

    } catch (error: any) {
      console.error("Failed to generate:", error);
      alert(`エラーが発生しました: ${error.message || "不明なエラー"}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentlyPlayingId === id) {
      stopSource();
      setCurrentlyPlayingId(null);
      setIsPlaying(false);
      setCurrentTime(0);
      pausedAtRef.current = 0;
      activeBufferRef.current = null;
    }
    setHistory(prev => prev.filter(item => item.id !== id));
  };

  const renderHistoryBubble = (item: GeneratedAudio) => {
    if (item.mode === 'single') {
      return <p className="text-sm text-slate-200 font-medium font-mono whitespace-pre-wrap">{item.text}</p>;
    }
    const lines = item.text.split('\n');
    return (
      <div className="space-y-2 mt-2">
        {lines.map((line, idx) => {
          let type: 'A' | 'B' | 'Both' | 'None' = 'None';
          let content = line;

          const bothPrefix = `${item.speaker1Name} & ${item.speaker2Name}:`;

          if (line.startsWith(bothPrefix)) {
            type = 'Both';
            content = line.replace(bothPrefix, '').trim();
          } else if (line.startsWith(`${item.speaker1Name}:`)) {
            type = 'A';
            content = line.replace(`${item.speaker1Name}:`, '').trim();
          } else if (line.startsWith(`${item.speaker2Name}:`)) {
            type = 'B';
            content = line.replace(`${item.speaker2Name}:`, '').trim();
          }
          if (type === 'None') return <div key={idx} className="text-center text-xs text-slate-500 my-1">{content}</div>

          return (
            <div key={idx} className={`flex ${type === 'A' ? 'justify-start' : type === 'B' ? 'justify-end' : 'justify-center'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-1.5 text-xs ${type === 'A'
                ? 'bg-indigo-900/40 text-indigo-100 border border-indigo-500/30 rounded-tl-none'
                : type === 'B'
                  ? 'bg-purple-900/40 text-purple-100 border border-purple-500/30 rounded-tr-none'
                  : 'bg-gradient-to-r from-indigo-900/40 to-purple-900/40 text-slate-100 border border-slate-500/30 font-bold'
                }`}>
                {content}
              </div>
            </div>
          )
        })}
      </div>
    );
  };

  const hasContent = mode === 'single' ? singleText.trim().length > 0 : (isScriptMode ? scriptText.trim().length > 0 : convLines.length > 0);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-4 md:p-8 font-sans">

      {/* Header */}
      <header className="mb-8 text-center max-w-2xl w-full relative">
        <div className="absolute right-0 top-0">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-all"
            title="設定"
          >
            <Settings className="w-6 h-6" />
          </button>
        </div>

        {showSettings && (
          <div className="absolute top-12 right-0 z-50 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-4 text-left animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 mb-3 text-indigo-400 font-bold">
              <Key className="w-4 h-4" /> API設定
            </div>
            <p className="text-xs text-slate-400 mb-2">
              Google Gemini APIキーを入力してください。<br />
              キーはブラウザにのみ保存されます。
            </p>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none mb-2"
            />
            <div className="text-right">
              <button
                onClick={() => setShowSettings(false)}
                className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded"
              >
                完了
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-3 mb-2">
          <Sparkles className="w-8 h-8 text-indigo-400" />
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
            感情ボイス AI
          </h1>
        </div>
        <p className="text-slate-400 mb-4">Gemini 2.5 日本語 Text-to-Speech</p>

        {/* Remaining Count Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-slate-800/80 border border-slate-700/50 rounded-full shadow-lg backdrop-blur-sm">
          <div className={`w-2 h-2 rounded-full animate-pulse ${remainingCount > 3 ? 'bg-green-500' : remainingCount > 0 ? 'bg-yellow-500' : 'bg-red-500'}`} />
          <span className="text-xs font-semibold text-slate-300">
            今日の残り生成回数: <span className={`text-sm ${remainingCount === 0 ? 'text-red-400' : 'text-indigo-400'}`}>{remainingCount}</span> / 10
          </span>
          <span className="text-[10px] text-slate-500 ml-1">(毎日 17:00 リセット)</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Left Column: Controls */}
        <div className="space-y-6">

          {/* Mode Tabs */}
          <div className="bg-slate-800/50 p-1 rounded-xl flex gap-1 border border-slate-700">
            <button
              onClick={() => setMode('single')}
              className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${mode === 'single'
                ? 'bg-indigo-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
            >
              <User className="w-4 h-4" /> シングル (1人)
            </button>
            <button
              onClick={() => setMode('conversation')}
              className={`flex-1 py-2 px-4 rounded-lg flex items-center justify-center gap-2 font-medium transition-all ${mode === 'conversation'
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
            >
              <Users className="w-4 h-4" /> 会話 (2人)
            </button>
          </div>

          {/* SINGLE MODE UI */}
          {mode === 'single' && (
            <>
              {/* Voice Select */}
              <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700 shadow-xl">
                <label className="block text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                  <Globe className="w-4 h-4" /> 声の選択
                </label>
                <select
                  value={selectedVoiceId}
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  {VOICES.map(v => <option key={v.id} value={v.id}>{VOICE_LABELS[v.name]}</option>)}
                </select>
              </div>

              {/* Character Description (New) */}
              <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700 shadow-xl">
                <label className="block text-sm font-medium text-slate-400 mb-2 flex items-center gap-2">
                  <User className="w-4 h-4" /> 人物像・話し方の指定
                </label>
                <textarea
                  value={singleDescription}
                  onChange={(e) => setSingleDescription(e.target.value)}
                  placeholder="例: 30代のサラリーマン。少し疲れ気味だが誠実な話し方。"
                  className="w-full h-16 bg-slate-900/80 border border-slate-700 rounded-lg p-3 text-sm text-white placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>

              {/* Text Input */}
              <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700 shadow-xl backdrop-blur-sm">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-slate-400 flex items-center gap-2">
                    <Mic className="w-4 h-4" /> テキスト入力
                  </label>
                  <span className={`text-xs ${singleText.length > MAX_CHARS ? 'text-red-400 font-bold' : 'text-slate-500'}`}>
                    {singleText.length} / {MAX_CHARS}
                  </span>
                </div>
                <div className="flex gap-2 overflow-x-auto custom-scrollbar mb-2 pb-1">
                  {EMOTION_TAGS.map((tag) => (
                    <button
                      key={tag.tag}
                      onClick={() => {
                        if (singleText.length + tag.tag.length <= MAX_CHARS) {
                          setSingleText(prev => prev + tag.tag);
                          textareaRef.current?.focus();
                        }
                      }}
                      className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition-colors whitespace-nowrap"
                    >
                      {tag.label}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={textareaRef}
                  value={singleText}
                  onChange={(e) => setSingleText(e.target.value)}
                  maxLength={MAX_CHARS}
                  placeholder="ここに読み上げさせたい日本語を入力してください..."
                  className="w-full h-40 bg-slate-900/80 border border-slate-700 rounded-xl p-4 text-base md:text-lg text-white placeholder-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none leading-relaxed"
                />
              </div>
            </>
          )}

          {/* CONVERSATION MODE UI */}
          {mode === 'conversation' && (
            <>
              {/* Speaker Config */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-800/50 rounded-2xl p-3 border border-slate-700 shadow-xl space-y-2">
                  <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
                    <User className="w-3 h-3" /> Speaker A (左)
                  </div>
                  <input
                    type="text"
                    value={speaker1Name}
                    onChange={(e) => setSpeaker1Name(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:border-indigo-500 outline-none"
                    placeholder="名前"
                  />
                  <select
                    value={speaker1Id}
                    onChange={(e) => setSpeaker1Id(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-xs text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                  >
                    {VOICES.map(v => <option key={v.id} value={v.id}>{v.name} ({v.gender === 'Male' ? '男' : '女'})</option>)}
                  </select>
                </div>

                <div className="bg-slate-800/50 rounded-2xl p-3 border border-slate-700 shadow-xl space-y-2">
                  <div className="flex items-center gap-2 text-purple-400 font-bold text-xs uppercase tracking-wider">
                    <User className="w-3 h-3" /> Speaker B (右)
                  </div>
                  <input
                    type="text"
                    value={speaker2Name}
                    onChange={(e) => setSpeaker2Name(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:border-purple-500 outline-none"
                    placeholder="名前"
                  />
                  <select
                    value={speaker2Id}
                    onChange={(e) => setSpeaker2Id(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-xs text-white focus:ring-1 focus:ring-purple-500 outline-none"
                  >
                    {VOICES.map(v => <option key={v.id} value={v.id}>{v.name} ({v.gender === 'Male' ? '男' : '女'})</option>)}
                  </select>
                </div>
              </div>

              {/* Context / Situation */}
              <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700 shadow-xl">
                <label className="block text-xs font-medium text-slate-400 mb-2 flex items-center gap-2">
                  <MessageSquare className="w-3 h-3" /> シチュエーション・関係性 (AIへの指示)
                </label>
                <textarea
                  value={contextDescription}
                  onChange={(e) => setContextDescription(e.target.value)}
                  placeholder="例: 上司と部下。上司は怒っているが、部下はとぼけている。漫才のような掛け合い。"
                  className="w-full h-16 bg-slate-900/80 border border-slate-700 rounded-lg p-3 text-sm text-white placeholder-slate-600 focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>

              {/* Conversation Builder */}
              <div className="bg-slate-800/50 rounded-2xl border border-slate-700 shadow-xl overflow-hidden flex flex-col h-[480px]">

                {/* Header (Toggle) */}
                <div className="bg-slate-800 border-b border-slate-700 p-2 flex justify-end gap-2">
                  <button
                    onClick={() => {
                      if (isScriptMode) saveScript();
                      else setIsScriptMode(true);
                    }}
                    className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded transition-colors ${isScriptMode
                      ? 'bg-slate-700 text-white font-bold'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                      }`}
                  >
                    <FileText className="w-3 h-3" /> スクリプト編集
                  </button>
                  <button
                    onClick={() => setIsScriptMode(false)}
                    className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded transition-colors ${!isScriptMode
                      ? 'bg-slate-700 text-white font-bold'
                      : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                      }`}
                  >
                    <List className="w-3 h-3" /> 吹き出しモード
                  </button>
                </div>

                {/* Content */}
                {isScriptMode ? (
                  <div className="flex-1 flex flex-col p-4 bg-slate-900/50">
                    <div className="text-[10px] text-slate-500 mb-2">
                      A: Aさんのセリフ / B: Bさんのセリフ / A&B: 二人同時<br />
                      例) <br />
                      A: おはよう<br />
                      B: (Happy) おはようございます！<br />
                      A&B: やったー！
                    </div>
                    <textarea
                      value={scriptText}
                      onChange={(e) => setScriptText(e.target.value)}
                      className="flex-1 w-full bg-slate-800 border border-slate-600 rounded-lg p-3 text-sm font-mono text-white resize-none focus:ring-2 focus:ring-indigo-500 outline-none leading-relaxed"
                      placeholder="スクリプトを入力..."
                    />
                    <div className="mt-2 flex gap-2">
                      {EMOTION_TAGS.map((tag) => (
                        <button
                          key={tag.tag}
                          onClick={() => handleInsertTag(tag.tag)}
                          className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition-colors whitespace-nowrap"
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Timeline */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-900/50 custom-scrollbar">
                      {convLines.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-600 space-y-2">
                          <MessageSquare className="w-8 h-8 opacity-20" />
                          <span className="text-xs">下の入力欄から会話を追加してください</span>
                        </div>
                      )}
                      {convLines.map((line) => (
                        <div key={line.id} className={`flex items-start gap-2 ${line.speaker === 'A' ? 'justify-start' : line.speaker === 'B' ? 'justify-end' : 'justify-center'}`}>
                          {line.speaker === 'A' && (
                            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] text-white font-bold shrink-0 mt-1">A</div>
                          )}

                          <div className={`relative group max-w-[80%] p-3 rounded-2xl text-sm ${line.speaker === 'A'
                            ? 'bg-indigo-900/60 text-indigo-100 rounded-tl-none border border-indigo-500/20'
                            : line.speaker === 'B'
                              ? 'bg-purple-900/60 text-purple-100 rounded-tr-none border border-purple-500/20'
                              : 'bg-gradient-to-r from-indigo-900/60 to-purple-900/60 text-slate-100 border border-slate-500/30 text-center mx-4 font-bold'
                            }`}>
                            {line.text}
                            <button
                              onClick={() => handleDeleteLine(line.id)}
                              className="absolute -top-2 -right-2 bg-slate-800 rounded-full p-1 text-slate-400 opacity-0 group-hover:opacity-100 transition-all hover:text-red-400 border border-slate-600"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>

                          {line.speaker === 'B' && (
                            <div className="w-6 h-6 rounded-full bg-purple-600 flex items-center justify-center text-[10px] text-white font-bold shrink-0 mt-1">B</div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Input Area */}
                    <div className="bg-slate-800 p-3 border-t border-slate-700">
                      <div className="flex gap-1 overflow-x-auto custom-scrollbar mb-2 pb-1">
                        <span className="text-[10px] text-slate-500 self-center mr-1">感情:</span>
                        {EMOTION_TAGS.map((tag) => (
                          <button
                            key={tag.tag}
                            onClick={() => handleInsertTag(tag.tag)}
                            className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition-colors whitespace-nowrap"
                          >
                            {tag.label}
                          </button>
                        ))}
                      </div>

                      <input
                        id="line-input"
                        type="text"
                        value={newLineText}
                        onChange={(e) => setNewLineText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                          }
                        }}
                        placeholder="発言を入力..."
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:ring-1 focus:ring-indigo-500 outline-none mb-2"
                      />

                      <div className="grid grid-cols-5 gap-2">
                        <button
                          onClick={() => handleAddLine('A')}
                          disabled={!newLineText.trim()}
                          className="col-span-2 flex items-center justify-center gap-1 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white py-2 rounded-lg text-xs font-bold transition-colors"
                        >
                          <ArrowLeft className="w-3 h-3" /> {speaker1Name}
                        </button>

                        <button
                          onClick={() => handleAddLine('Both')}
                          disabled={!newLineText.trim()}
                          className="col-span-1 flex items-center justify-center gap-1 bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white py-2 rounded-lg text-xs font-bold transition-colors"
                          title="二人同時"
                        >
                          <ArrowUp className="w-3 h-3" /> & <ArrowUp className="w-3 h-3" />
                        </button>

                        <button
                          onClick={() => handleAddLine('B')}
                          disabled={!newLineText.trim()}
                          className="col-span-2 flex items-center justify-center gap-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white py-2 rounded-lg text-xs font-bold transition-colors"
                        >
                          {speaker2Name} <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Action Button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !hasContent}
            className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all transform active:scale-[0.98] ${isGenerating || !hasContent
              ? "bg-slate-700 text-slate-500 cursor-not-allowed"
              : "bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-400 hover:to-purple-400 text-white shadow-indigo-500/25"
              }`}
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" /> 生成中...
              </>
            ) : (
              <>
                <Sparkles className="w-6 h-6" /> 音声を生成
              </>
            )}
          </button>
        </div>

        {/* Right Column: Output & History */}
        <div className="space-y-6 flex flex-col h-full">

          {/* PLAYER AREA */}
          <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700 shadow-inner relative overflow-hidden shrink-0 flex flex-col justify-end min-h-[160px]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-950 opacity-50 pointer-events-none" />

            {/* Waveform Visualization */}
            <div className="absolute inset-0 z-0 opacity-30 flex items-center">
              <Waveform isPlaying={isPlaying} />
            </div>

            <div className="relative z-10 w-full space-y-4">
              {currentlyPlayingId ? (
                <>
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs text-indigo-400 font-mono">{formatTime(currentTime)}</span>
                    <span className="text-xs text-slate-500 font-mono">{formatTime(duration)}</span>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.01}
                    value={currentTime}
                    onChange={handleSeek}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
                  />

                  <div className="flex justify-center items-center gap-6">
                    <button
                      onClick={isPlaying ? handlePause : () => activeBufferRef.current && playAudio(currentlyPlayingId, activeBufferRef.current, pausedAtRef.current)}
                      className="w-12 h-12 bg-white text-slate-900 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-white/10"
                    >
                      {isPlaying ? <Pause className="fill-current w-5 h-5" /> : <Play className="fill-current w-5 h-5 ml-0.5" />}
                    </button>

                    <button
                      onClick={() => activeBufferRef.current && handleDownload(activeBufferRef.current, `kanjo-voice-${currentlyPlayingId}`)}
                      className="w-10 h-10 bg-slate-800 text-slate-400 rounded-full flex items-center justify-center hover:bg-slate-700 hover:text-white transition-all border border-slate-700"
                      title="音声保存 (WAV)"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-600 py-4">
                  <Music className="w-10 h-10 mb-2 opacity-20" />
                  <span className="text-sm">再生する履歴を選択</span>
                </div>
              )}
            </div>
          </div>

          {/* History List */}
          <div className="flex-1 bg-slate-800/50 rounded-2xl border border-slate-700 shadow-xl overflow-hidden flex flex-col min-h-[400px]">
            <div className="p-4 border-b border-slate-700 bg-slate-800/80 backdrop-blur-md sticky top-0 z-20 flex justify-between items-center">
              <h2 className="font-semibold text-slate-300 flex items-center gap-2">
                <List className="w-4 h-4" /> 履歴
              </h2>
              {history.length > 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setHistory([]); stopSource(); setCurrentlyPlayingId(null); }}
                  className="text-xs text-slate-500 hover:text-red-400"
                >
                  全て削除
                </button>
              )}
            </div>

            <div className="overflow-y-auto flex-1 p-4 space-y-3 custom-scrollbar">
              {history.length === 0 && (
                <div className="text-center text-slate-500 py-10 italic">
                  まだ履歴がありません。
                </div>
              )}

              {history.map((item) => (
                <div
                  key={item.id}
                  onClick={() => playAudio(item.id, item.audioBuffer)}
                  className={`group relative p-4 rounded-xl border transition-all cursor-pointer hover:shadow-lg ${currentlyPlayingId === item.id
                    ? "bg-slate-700/80 border-indigo-500/50 ring-1 ring-indigo-500/20"
                    : "bg-slate-800 border-slate-700 hover:bg-slate-750 hover:border-slate-600"
                    }`}
                >
                  <div className="flex justify-between items-start mb-2 border-b border-slate-700/50 pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase font-bold tracking-wider ${item.mode === 'conversation' ? 'bg-purple-600 text-white' : 'bg-indigo-600 text-white'}`}>
                        {item.mode === 'single' ? 'SINGLE' : 'CONV'}
                      </span>
                      {item.contextDescription && (
                        <span className="text-[10px] text-slate-400 truncate max-w-[150px] italic">
                          {item.mode === 'conversation' ? 'Sit: ' : 'Char: '}{item.contextDescription}
                        </span>
                      )}
                    </div>
                    {item.mode === 'single' && (
                      <div className="text-xs text-slate-400 bg-slate-900 px-2 py-0.5 rounded flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        {item.voiceName}
                      </div>
                    )}
                  </div>

                  {/* Bubble Render */}
                  <div className="mt-2">
                    {renderHistoryBubble(item)}
                  </div>

                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDownload(item.audioBuffer, `kanjo-voice-${item.id}`); }}
                      className="p-1.5 hover:bg-slate-600/50 rounded-lg text-slate-400 hover:text-white transition-colors"
                      title="保存"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => deleteHistoryItem(item.id, e)}
                      className="p-1.5 hover:bg-red-500/20 rounded-lg text-slate-500 hover:text-red-400 transition-colors"
                      title="削除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;