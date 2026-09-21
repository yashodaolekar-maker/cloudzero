import { motion, useReducedMotion } from "motion/react";

interface CloudZeroLogoProps { compact?: boolean; className?: string }

export default function CloudZeroLogo({ compact = false, className = "" }: CloudZeroLogoProps) {
  const reduceMotion = useReducedMotion();
  return (
    <div className={`cz-logo ${className}`} aria-label="CloudZero">
      <motion.span className="cz-logo-mark" whileHover={reduceMotion ? undefined : { scale: 1.04 }} transition={{ type: "spring", stiffness: 350, damping: 24 }} aria-hidden="true">
        <svg viewBox="0 0 48 48">
          <defs><linearGradient id="cz-signal" x1="8" y1="7" x2="40" y2="41" gradientUnits="userSpaceOnUse"><stop stopColor="#79E7FF"/><stop offset=".52" stopColor="#2F6BFF"/><stop offset="1" stopColor="#8B5CF6"/></linearGradient></defs>
          <path className="cz-logo-boundary" d="M16.2 35.5h17.1a8 8 0 0 0 1.1-15.9A11.7 11.7 0 0 0 12.2 18a8.9 8.9 0 0 0 4 17.5Z"/>
          <circle className="cz-logo-portal" cx="24" cy="24" r="8.2"/><path className="cz-logo-link" d="M18.2 18.2 29.8 29.8"/>
          <circle className="cz-logo-node" cx="18.2" cy="18.2" r="2.3"/><circle className="cz-logo-node" cx="29.8" cy="29.8" r="2.3"/>
        </svg>
        <motion.i className="cz-logo-orbit" animate={reduceMotion ? undefined : { rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }}/>
      </motion.span>
      {!compact && <span className="cz-wordmark"><span><strong>Cloud</strong><strong>Zero</strong></span><small>Digital operations mesh</small></span>}
    </div>
  );
}
