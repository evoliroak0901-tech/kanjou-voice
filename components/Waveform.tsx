import React, { useEffect, useState } from 'react';

interface WaveformProps {
  isPlaying: boolean;
  color?: string;
}

export const Waveform: React.FC<WaveformProps> = ({ isPlaying, color = "bg-blue-500" }) => {
  // Simulate waveform bars
  const [bars, setBars] = useState<number[]>(new Array(20).fill(10));

  useEffect(() => {
    let interval: number;
    if (isPlaying) {
      interval = window.setInterval(() => {
        setBars(prev => prev.map(() => Math.floor(Math.random() * 80) + 10));
      }, 100);
    } else {
      setBars(new Array(20).fill(5));
    }

    return () => clearInterval(interval);
  }, [isPlaying]);

  return (
    <div className="flex items-center justify-center gap-1 h-24 w-full bg-slate-800/50 rounded-lg p-4 backdrop-blur-sm border border-slate-700">
      {bars.map((height, i) => (
        <div
          key={i}
          className={`w-2 rounded-full transition-all duration-100 ease-in-out ${color}`}
          style={{ height: `${height}%`, opacity: isPlaying ? 1 : 0.3 }}
        />
      ))}
    </div>
  );
};
