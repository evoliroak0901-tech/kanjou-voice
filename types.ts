export enum Emotion {
  NEUTRAL = 'Neutral',
  HAPPY = 'Happy',
  SAD = 'Sad',
  ANGRY = 'Angry',
  EXCITED = 'Excited',
  WHISPER = 'Whisper',
  FEARFUL = 'Fearful',
  ROBOTIC = 'Robotic'
}

export type AppMode = 'single' | 'conversation';

export interface VoiceOption {
  name: string;
  id: string; // Internal ID for logic
  apiName: string; // The name expected by the API (e.g., 'Kore')
  gender: 'Male' | 'Female';
}

export interface ConversationLine {
  id: string;
  speaker: 'A' | 'B' | 'Both';
  text: string;
  emotion?: string; // e.g., "(Happy)"
}

export interface GeneratedAudio {
  id: string;
  text: string; // Compiled text for display in history
  mode: AppMode;
  emotion?: Emotion; // Single mode only
  voiceName?: string; // Single mode only
  speaker1?: string; // Conversation mode
  speaker2?: string; // Conversation mode
  speaker1Name?: string; // Custom name for Speaker A
  speaker2Name?: string; // Custom name for Speaker B
  contextDescription?: string; // Situation description
  timestamp: number;
  audioBuffer: AudioBuffer;
}

export interface GenerateSpeechRequest {
  text: string;
  mode: AppMode;
  emotion?: Emotion;
  voice?: VoiceOption;
  speaker1?: VoiceOption;
  speaker2?: VoiceOption;
  speaker1Name?: string;
  speaker2Name?: string;
  contextDescription?: string;
  apiKey?: string;
}