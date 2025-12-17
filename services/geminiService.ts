import { GoogleGenAI, Modality } from "@google/genai";
import { Emotion, VoiceOption, GenerateSpeechRequest } from "../types";
import { EMOTION_PROMPTS } from "../constants";
import { decodeBase64, decodeAudioData } from "./audioUtils";

// Singleton AudioContext
let sharedAudioContext: AudioContext | null = null;

export const getAudioContext = () => {
  if (!sharedAudioContext) {
    sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return sharedAudioContext;
};

export const generateSpeech = async (request: GenerateSpeechRequest): Promise<AudioBuffer> => {
  const apiKey = request.apiKey || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing");
  }

  const ai = new GoogleGenAI({ apiKey });
  const { mode, text, emotion, voice, speaker1, speaker2, speaker1Name, speaker2Name, contextDescription } = request;

  let prompt = "";
  let config: any = {
    responseModalities: [Modality.AUDIO],
  };

  if (mode === 'single') {
    if (!emotion || !voice) throw new Error("Missing parameters for single mode");

    // Check if the voice is a standard API voice or a Persona preset
    const standardNames = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];
    let effectiveDesc = contextDescription || "";

    // If it's a Persona (e.g., 'Child', 'Announcer'), inject it into the style instruction
    if (!standardNames.includes(voice.name)) {
      effectiveDesc = `Role/Tone: ${voice.name}. ${effectiveDesc}`;
    }

    const styleInstruction = effectiveDesc ? `Character/Style setting: ${effectiveDesc}` : "";

    // Allow emotion tags in text to override base emotion
    prompt = `
      Base Tone: ${EMOTION_PROMPTS[emotion]}
      ${styleInstruction}
      
      Instruction: 
      1. Read the following text naturally in Japanese. 
      2. If a "Character/Style setting" is provided, strictly adopt that persona and speaking style.
      3. If there are emotion tags like (Happy), (Sad), (Whisper) in the text, strictly change the tone accordingly for that part.
      4. Occasionally and naturally insert fillers like "えっと" (etto), "あ、" (ah), "んー" (mm) at the beginning of sentences to make it sound more human-like. Do not do this for every sentence, only where it feels extremely natural.
      
      Text:
      ${text}
    `;

    config.speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: voice.apiName },
      },
    };
  } else {
    // Conversation Mode
    if (!speaker1 || !speaker2) throw new Error("Missing speakers for conversation mode");

    const nameA = speaker1Name || 'Speaker A';
    const nameB = speaker2Name || 'Speaker B';
    const context = contextDescription ? `Situation/Context: ${contextDescription}` : "";

    // Conversation Prompt
    prompt = `
      Task: TTS the following conversation between ${nameA} and ${nameB}.
      Language: Japanese.
      ${context}
      
      Instruction: 
      1. Strictly distinguish the voices for ${nameA} and ${nameB}.
      2. Act out the scene based on the "Situation/Context" provided above.
      3. If there are emotion tags like (Happy), (Sad), (Whisper) in the text, strictly change the tone accordingly for that line.
      4. Occasionally and naturally insert fillers like "えっと" (etto), "あ、" (ah), "んー" (mm) at the beginning of sentences to make it sound more human-like. Do not do this for every sentence, only where it feels extremely natural to the context.
      5. If a line is attributed to "${nameA} & ${nameB}", try to make it sound like they are speaking together or in immediate agreement.
      
      Conversation Script:
      ${text}`;

    config.speechConfig = {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          {
            speaker: nameA,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker1.apiName } }
          },
          {
            speaker: nameB,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: speaker2.apiName } }
          }
        ]
      }
    };
  }

  console.log(`Generating ${mode} speech...`, { speaker1Name, speaker2Name, contextDescription });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: prompt }] }],
      config: config,
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!base64Audio) {
      console.error("Gemini response did not contain inlineData.data", response);
      throw new Error("Geminiから音声データが返されませんでした。");
    }

    const ctx = getAudioContext();
    const rawBytes = decodeBase64(base64Audio);
    const audioBuffer = await decodeAudioData(rawBytes, ctx, 24000, 1);

    return audioBuffer;

  } catch (error) {
    console.error("Error inside generateSpeech:", error);
    throw error;
  }
};