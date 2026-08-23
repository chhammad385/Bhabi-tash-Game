import React, { useState } from 'react';
import { BookOpen, Sparkles, Flame, ShieldAlert, Award, ArrowRight, ArrowLeft, Handshake } from 'lucide-react';
import { CardView } from './CardView';

interface RulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RulesModal: React.FC<RulesModalProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const steps = [
    {
      title: '1. Objective: The Great Getaway',
      description:
        'Bhabhi (also known as Thulla or Getaway) is a fast-paced card game where your only goal is to get rid of all your cards! The first player to exhaust their cards wins 1st Place Safe. The game continues until only ONE player is left holding cards — they are crowned the BHABHI (loser)!',
      icon: <Sparkles className="w-6 h-6 text-amber-400" />,
      cards: [
        { suit: 'S' as const, rank: 'A' },
        { suit: 'H' as const, rank: 'K' },
        { suit: 'D' as const, rank: 'Q' },
      ],
    },
    {
      title: '2. One Deck & Opening Sar (♠A - No Thulla)',
      description:
        'The game begins with the Ace of Spades (♠A). In this very first Sar / trick, NO THULLA penalty is given! If a player does not have a Spade, they discard any card of another suit ("Rangbranga"). All cards in the 1st trick are cleanly discarded into the dead pile. Whoever throws the highest off-suit card (or highest Spade if all followed suit) gets the lead for the next Sar!',
      icon: <BookOpen className="w-6 h-6 text-indigo-400" />,
      cards: [
        { suit: 'S' as const, rank: 'A' },
        { suit: 'S' as const, rank: 'K' },
        { suit: 'H' as const, rank: 'A' },
      ],
    },
    {
      title: '3. Follow Suit Rule',
      description:
        'Whoever wins a trick leads the next round by playing any card they wish. Every subsequent player MUST follow the lead suit. Ranks from high to low: A, K, Q, J, 10, 9, 8, 7, 6, 5, 4, 3, 2. If everyone follows suit, the player with the highest card wins the trick and all cards are discarded into the dead pile!',
      icon: <Award className="w-6 h-6 text-emerald-400" />,
      cards: [
        { suit: 'H' as const, rank: 'A' },
        { suit: 'H' as const, rank: 'Q' },
        { suit: 'H' as const, rank: '7' },
      ],
    },
    {
      title: '4. The Tochoo (Thulla) Strike!',
      description:
        'If a player does NOT have any card of the led suit in their hand, they can throw ANY card from another suit — this is called a TOCHOO (Thulla)! The player who played the highest card of the original lead suit must PICK UP all played cards in the trick into their hand!',
      icon: <Flame className="w-6 h-6 text-rose-500" />,
      cards: [
        { suit: 'C' as const, rank: 'K' },
        { suit: 'C' as const, rank: 'J' },
        { suit: 'H' as const, rank: '2' }, // Tochoo card
      ],
    },
    {
      title: '5. Safe & The Bhabhi Crown',
      description:
        'When you play your last card, you become SAFE and escape the game. Play continues among the remaining players. The single player remaining with cards after all others have escaped becomes the BHABHI!',
      icon: <ShieldAlert className="w-6 h-6 text-amber-500" />,
      cards: [
        { suit: 'D' as const, rank: 'A' },
        { suit: 'S' as const, rank: '2' },
      ],
    },
    {
      title: '6. Card Request & Offer (Mera Pata Le Lo / Apna Pata Mujhe De Do)',
      description:
        'During active play, players can exchange hands:\n1. "Mera Pata Le Lo" (Offer Cards): You offer your cards to the previous player. If they accept, you give away your cards and immediately escape as SAFE!\n2. "Apna Pata Mujhe De Do" (Request Cards): You request the next player to hand over their cards to you. If they accept, they give you their cards and immediately escape as SAFE!',
      icon: <Handshake className="w-6 h-6 text-indigo-400" />,
      cards: [
        { suit: 'H' as const, rank: 'J' },
        { suit: 'C' as const, rank: '8' },
        { suit: 'D' as const, rank: '4' },
      ],
    },
    {
      title: '7. 1-on-1 Blind Card Pull (پتہ کھینچنا)',
      description:
        'When only 2 players remain and Player A finishes their hand with the highest card (holding the lead), Player A pulls 1 blind face-down card from Player B. If Player B plays a HIGHER card of that suit, Player B wins and Player A escapes as SAFE (Player B is Bhabhi). If Player B plays a LOWER card, Player A wins and pulls another blind card next trick. If Player B has NO cards of that suit, they give THULLA and Player A picks up the penalty cards!',
      icon: <Sparkles className="w-6 h-6 text-amber-400" />,
      cards: [
        { suit: 'S' as const, rank: 'A' },
        { suit: 'S' as const, rank: '7' },
        { suit: 'D' as const, rank: 'K' },
      ],
    },
  ];

  const active = steps[currentStep];

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-white">How to Play Bhabhi</h3>
          </div>
          <button
            id="close-rules-modal-btn"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold"
          >
            ✕
          </button>
        </div>

        {/* Step Content */}
        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-slate-800/80 border border-slate-700">
              {active.icon}
            </div>
            <h4 className="text-base sm:text-lg font-bold text-white">{active.title}</h4>
          </div>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed min-h-[70px]">
            {active.description}
          </p>

          {/* Visual Cards Example */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex items-center justify-center gap-3">
            {active.cards.map((c, i) => (
              <CardView key={i} card={{ id: `rule-${i}`, suit: c.suit, rank: c.rank } as any} size="md" />
            ))}
          </div>
        </div>

        {/* Step Dots & Navigation */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentStep(i)}
                className={`w-2.5 h-2.5 rounded-full transition ${
                  currentStep === i ? 'bg-amber-400 w-6' : 'bg-slate-700'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
              disabled={currentStep === 0}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 transition"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            {currentStep < steps.length - 1 ? (
              <button
                onClick={() => setCurrentStep((prev) => prev + 1)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition flex items-center gap-1"
              >
                <span>Next</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                id="rules-got-it-btn"
                onClick={onClose}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition"
              >
                Got It! Let's Play
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
