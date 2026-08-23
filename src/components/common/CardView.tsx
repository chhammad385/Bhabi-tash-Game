import React from 'react';
import { Card, Suit } from '../../types/game';

interface CardViewProps {
  card?: Card;
  isFaceDown?: boolean;
  isLegal?: boolean;
  isDisabled?: boolean;
  isSelected?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  onClick?: () => void;
  className?: string;
  badge?: string;
}

export const CardView: React.FC<CardViewProps> = ({
  card,
  isFaceDown = false,
  isLegal = false,
  isDisabled = false,
  isSelected = false,
  size = 'md',
  onClick,
  className = '',
  badge,
}) => {
  const getSuitSymbol = (suit: Suit) => {
    switch (suit) {
      case 'S': return '♠';
      case 'H': return '♥';
      case 'D': return '♦';
      case 'C': return '♣';
    }
  };

  const isRed = card?.suit === 'H' || card?.suit === 'D';

  // Size dimensions using standard 2:3 card aspect ratio with ample internal clearance
  const sizeConfig = {
    xs: {
      container: 'w-9 h-13 sm:w-11 sm:h-16 rounded shadow-xs',
      cornerRank: 'text-[8px] sm:text-[10px] font-black',
      cornerSuit: 'text-[7px] sm:text-[9px]',
      centerSuit: 'text-sm sm:text-lg',
      padding: 'p-0.5',
    },
    sm: {
      container: 'w-11 h-16 sm:w-14 sm:h-20 rounded-md shadow-sm',
      cornerRank: 'text-[9px] sm:text-xs font-black',
      cornerSuit: 'text-[8px] sm:text-[11px]',
      centerSuit: 'text-base sm:text-2xl',
      padding: 'p-1',
    },
    md: {
      container: 'w-13 h-19 sm:w-18 sm:h-26 md:w-20 md:h-28 rounded-lg shadow-md',
      cornerRank: 'text-[11px] sm:text-sm font-black',
      cornerSuit: 'text-[10px] sm:text-sm',
      centerSuit: 'text-xl sm:text-3xl',
      padding: 'p-1 sm:p-1.5',
    },
    lg: {
      container: 'w-16 h-24 sm:w-22 sm:h-32 md:w-24 md:h-36 rounded-xl shadow-lg',
      cornerRank: 'text-xs sm:text-base font-black',
      cornerSuit: 'text-xs sm:text-base',
      centerSuit: 'text-2xl sm:text-4xl',
      padding: 'p-1.5 sm:p-2',
    },
  }[size];

  if (isFaceDown || !card) {
    return (
      <div
        id={card ? `card-back-${card.id}` : undefined}
        className={`relative ${sizeConfig.container} bg-gradient-to-br from-indigo-900 via-blue-950 to-slate-950 border-2 border-indigo-500/40 flex items-center justify-center select-none overflow-hidden transform transition-transform duration-200 ${className}`}
      >
        {/* Card back lattice pattern */}
        <div className="w-[84%] h-[84%] border border-indigo-400/30 rounded flex items-center justify-center bg-indigo-950/60 shadow-inner">
          <div className="w-5 h-5 rounded-full border border-amber-400/50 flex items-center justify-center bg-indigo-900/80">
            <span className="text-xs text-amber-300 font-serif">♠</span>
          </div>
        </div>
      </div>
    );
  }

  const suitSymbol = getSuitSymbol(card.suit);

  return (
    <div
      id={`card-${card.id}`}
      onClick={!isDisabled && onClick ? onClick : undefined}
      className={`relative ${sizeConfig.container} bg-white border flex items-center justify-center select-none overflow-hidden transition-all duration-200 ${
        isRed ? 'text-rose-600 border-rose-200/80' : 'text-slate-900 border-slate-300'
      } ${
        isLegal
          ? 'ring-2 ring-amber-400 shadow-lg shadow-amber-400/30 hover:-translate-y-3 sm:hover:-translate-y-4 hover:shadow-xl cursor-pointer active:scale-95'
          : ''
      } ${
        isSelected ? '-translate-y-4 ring-2 ring-emerald-500 shadow-lg shadow-emerald-400/40' : ''
      } ${
        isDisabled ? 'opacity-40 grayscale cursor-not-allowed hover:translate-y-0' : 'cursor-pointer'
      } ${className}`}
    >
      {/* Top-Left Corner: Rank on top, Suit below */}
      <div className="absolute top-1 left-1 flex flex-col items-center leading-none pointer-events-none">
        <span className={`${sizeConfig.cornerRank} font-mono tracking-tight`}>{card.rank}</span>
        <span className={`${sizeConfig.cornerSuit} -mt-0.5`}>{suitSymbol}</span>
      </div>

      {/* Center Suit Watermark */}
      <div className="flex items-center justify-center pointer-events-none">
        <span className={`${sizeConfig.centerSuit} font-bold opacity-90 drop-shadow-sm select-none`}>
          {suitSymbol}
        </span>
      </div>

      {/* Bottom-Right Corner: Inverted (180deg) Rank & Suit */}
      <div className="absolute bottom-1 right-1 flex flex-col items-center leading-none rotate-180 pointer-events-none">
        <span className={`${sizeConfig.cornerRank} font-mono tracking-tight`}>{card.rank}</span>
        <span className={`${sizeConfig.cornerSuit} -mt-0.5`}>{suitSymbol}</span>
      </div>

      {/* Badge Indicator if any */}
      {badge && (
        <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-amber-500 text-slate-950 text-[9px] font-black rounded-full shadow-md z-10">
          {badge}
        </span>
      )}
    </div>
  );
};
