import { Emotion, VoiceOption } from './types';

export const VOICES: VoiceOption[] = [
  // Standard API Voices
  { name: 'Kore', id: 'kore', apiName: 'Kore', gender: 'Female' },
  { name: 'Puck', id: 'puck', apiName: 'Puck', gender: 'Male' },
  { name: 'Charon', id: 'charon', apiName: 'Charon', gender: 'Male' },
  { name: 'Fenrir', id: 'fenrir', apiName: 'Fenrir', gender: 'Male' },
  { name: 'Zephyr', id: 'zephyr', apiName: 'Zephyr', gender: 'Female' },
  
  // Persona Presets (Mapped to suitable API voices)
  { name: 'Child', id: 'child', apiName: 'Puck', gender: 'Male' }, // Puck fits energetic/mascot/child
  { name: 'Youth', id: 'youth', apiName: 'Fenrir', gender: 'Male' }, // Fenrir for young adult male
  { name: 'Announcer', id: 'announcer', apiName: 'Zephyr', gender: 'Female' }, // Zephyr for clear speaking
  { name: 'Comedian', id: 'comedian', apiName: 'Puck', gender: 'Male' }, // Puck for expressive/quirky
  { name: 'Narration', id: 'narration', apiName: 'Charon', gender: 'Male' }, // Charon for deep narration
  { name: 'News', id: 'news', apiName: 'Kore', gender: 'Female' }, // Kore for calm news reading
];

export const VOICE_LABELS: Record<string, string> = {
  'Kore': 'Kore (女性・落ち着き)',
  'Puck': 'Puck (男性・低音)',
  'Charon': 'Charon (男性・深み)',
  'Fenrir': 'Fenrir (男性・力強い)',
  'Zephyr': 'Zephyr (女性・明快)',
  'Child': '子ども',
  'Youth': '青年',
  'Announcer': 'アナウンサー',
  'Comedian': 'コメディアン',
  'Narration': 'ナレーション',
  'News': 'ニュース',
};

export const EMOTION_LABELS: Record<Emotion, string> = {
  [Emotion.NEUTRAL]: '普通',
  [Emotion.HAPPY]: '喜び',
  [Emotion.SAD]: '悲しみ',
  [Emotion.ANGRY]: '怒り',
  [Emotion.EXCITED]: '興奮',
  [Emotion.WHISPER]: 'ささやき',
  [Emotion.FEARFUL]: '恐怖',
  [Emotion.ROBOTIC]: 'ロボット',
};

// Used for single mode system prompt prefix
export const EMOTION_PROMPTS: Record<Emotion, string> = {
  [Emotion.NEUTRAL]: 'Say normally:',
  [Emotion.HAPPY]: 'Say cheerfully and with a big smile:',
  [Emotion.SAD]: 'Say sorrowfully and with a crying voice:',
  [Emotion.ANGRY]: 'Say angrily and aggressively:',
  [Emotion.EXCITED]: 'Say with high energy and excitement:',
  [Emotion.WHISPER]: 'Whisper quietly:',
  [Emotion.FEARFUL]: 'Say with fear and trembling:',
  [Emotion.ROBOTIC]: 'Say in a monotonous, robotic voice:',
};

// Used for insertion in text
export const EMOTION_TAGS = [
  { label: '普通', tag: '(Neutral) ' },
  { label: '喜び', tag: '(Happy) ' },
  { label: '悲しみ', tag: '(Sad) ' },
  { label: '怒り', tag: '(Angry) ' },
  { label: '興奮', tag: '(Excited) ' },
  { label: 'ささやき', tag: '(Whisper) ' },
  { label: '恐怖', tag: '(Fearful) ' },
];

export const SAMPLE_TEXTS = [];