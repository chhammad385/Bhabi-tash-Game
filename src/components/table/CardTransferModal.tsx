import React, { useState, useEffect } from 'react';
import { CardTransferOffer, Card as CardType } from '../../types/game';
import { CardView } from '../common/CardView';
import { Handshake, ShieldCheck, X, Check, Clock, AlertCircle } from 'lucide-react';

interface CardTransferModalProps {
  offer: CardTransferOffer | null;
  currentUserId?: string;
  onRespond: (accept: boolean) => void;
}

export const CardTransferModal: React.FC<CardTransferModalProps> = ({
  offer,
  currentUserId,
  onRespond,
}) => {
  if (!offer || offer.status !== 'pending') return null;

  const isRecipient = offer.toPlayerId === currentUserId;
  const isSender = offer.fromPlayerId === currentUserId;
  const isGiveType = offer.type === 'give'; // fromPlayer gives cards to toPlayer
  const isTakeType = offer.type === 'take'; // fromPlayer takes cards from toPlayer

  const [timeLeft, setTimeLeft] = useState(20);

  useEffect(() => {
    const calcTime = () => {
      const remaining = Math.max(0, Math.ceil((offer.expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
    };
    calcTime();
    const interval = setInterval(calcTime, 500);
    return () => clearInterval(interval);
  }, [offer.expiresAt]);

  // Recipient Modal (Requires user to Accept or Decline)
  if (isRecipient) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in pointer-events-auto">
        <div
          id="card-transfer-recipient-modal"
          className="relative w-full max-w-lg bg-slate-900 border-2 border-amber-500/80 rounded-2xl p-5 sm:p-6 shadow-2xl overflow-hidden flex flex-col items-center text-center"
        >
          {/* Glowing background accent */}
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />

          {/* Icon Header */}
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-3 shadow-lg shadow-amber-500/10">
            <Handshake className="w-8 h-8" />
          </div>

          <h3 className="text-xl font-bold text-white tracking-wide">
            {isGiveType ? 'Offer My Cards Request!' : 'Request to Take Your Cards!'}
          </h3>

          <p className="text-xs text-amber-300/90 font-medium mt-1">
            {isGiveType ? (
              <>
                <span className="font-bold text-amber-200">{offer.fromPlayerName}</span> aap ko apne patte de kar Safe hona chahta hai.
              </>
            ) : (
              <>
                <span className="font-bold text-amber-200">{offer.fromPlayerName}</span> aap ke saare patte le kar aap ko Safe karna chahta hai!
              </>
            )}
          </p>

          {/* Time Left Badge */}
          <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-800/80 border border-slate-700 text-slate-300 rounded-full text-xs font-mono font-bold mt-2">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Time remaining: {timeLeft}s</span>
          </div>

          {/* Card Offer Details Box */}
          <div className="w-full bg-slate-950/80 border border-slate-800 rounded-xl p-4 my-4 flex flex-col items-center">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {isGiveType ? 'Offered Cards:' : 'Your Cards to Transfer:'}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-mono text-xs font-bold border border-amber-500/30">
                {offer.cardCount} Cards
              </span>
            </div>

            {/* Offered Cards Scroll Preview */}
            <div className="w-full flex items-center justify-center gap-2 overflow-x-auto py-2 px-1 max-w-full">
              {offer.cards && offer.cards.length > 0 ? (
                offer.cards.map((card, idx) => (
                  <div key={card.id || idx} className="shrink-0">
                    <CardView card={card} size="sm" isLegal={false} isDisabled={false} />
                  </div>
                ))
              ) : (
                <span className="text-xs text-slate-400 italic">All {offer.cardCount} cards in hand</span>
              )}
            </div>

            {/* Rule explanation */}
            <div className="w-full bg-amber-950/30 border border-amber-500/20 rounded-lg p-2.5 mt-3 text-left flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-slate-300 leading-relaxed">
                {isGiveType ? (
                  <>
                    <span className="text-emerald-300 font-bold">Agar aap Accept karenge:</span>{' '}
                    <span className="text-white font-semibold">{offer.fromPlayerName}</span> ke {offer.cardCount} patte aap ke paas aa jayen ge aur <span className="text-emerald-400 font-bold">{offer.fromPlayerName} SAFE</span> ho kar game se bahir nikal jaye ga.
                  </>
                ) : (
                  <>
                    <span className="text-emerald-300 font-bold">Agar aap Accept karenge:</span>{' '}
                    Aap ke saare {offer.cardCount} patte <span className="text-white font-semibold">{offer.fromPlayerName}</span> ke paas chale jayen ge aur <span className="text-emerald-400 font-bold">AAP FORAN SAFE</span> ho kar jeet jayen ge! 🎉
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="w-full grid grid-cols-2 gap-3 mt-1">
            <button
              id="decline-card-transfer-btn"
              onClick={() => onRespond(false)}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-bold border border-slate-700 flex items-center justify-center gap-2 transition cursor-pointer active:scale-95 shadow"
            >
              <X className="w-4 h-4 text-rose-400" />
              Decline
            </button>

            <button
              id="accept-card-transfer-btn"
              onClick={() => onRespond(true)}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-sm font-bold shadow-lg shadow-emerald-900/40 flex items-center justify-center gap-2 transition cursor-pointer active:scale-95 border border-emerald-400/40"
            >
              <Check className="w-4 h-4" />
              {isGiveType ? 'Take Cards' : 'Give Cards & Escape SAFE!'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Sender Status Banner (Shows waiting state)
  if (isSender) {
    return (
      <div className="mb-2 w-full max-w-lg mx-auto bg-amber-950/80 border border-amber-500/60 rounded-xl p-3 shadow-lg flex items-center justify-between gap-3 text-xs text-amber-200 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          <span>
            {isGiveType ? (
              <>
                Waiting for <strong className="text-white">{offer.toPlayerName}</strong> to accept your {offer.cardCount} cards (so you can escape Safe)...
              </>
            ) : (
              <>
                Waiting for <strong className="text-white">{offer.toPlayerName}</strong> to give you their {offer.cardCount} cards (so {offer.toPlayerName} can escape Safe)...
              </>
            )}
          </span>
        </div>
        <span className="font-mono font-bold text-amber-400 bg-amber-900/60 px-2 py-0.5 rounded border border-amber-500/40">
          {timeLeft}s
        </span>
      </div>
    );
  }

  // Spectator / Other Player Toast
  return (
    <div className="mb-2 w-full max-w-md mx-auto bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 shadow-md flex items-center justify-between gap-2 text-xs text-slate-300">
      <div className="flex items-center gap-2">
        <Handshake className="w-4 h-4 text-amber-400 shrink-0" />
        <span>
          {isGiveType ? (
            <>
              <strong className="text-white">{offer.fromPlayerName}</strong> offered their {offer.cardCount} cards to <strong className="text-white">{offer.toPlayerName}</strong>.
            </>
          ) : (
            <>
              <strong className="text-white">{offer.fromPlayerName}</strong> requested <strong className="text-white">{offer.toPlayerName}</strong>'s {offer.cardCount} cards.
            </>
          )}
        </span>
      </div>
      <span className="font-mono text-[10px] text-slate-400">{timeLeft}s</span>
    </div>
  );
};
