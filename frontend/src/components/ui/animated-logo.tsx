export function AnimatedLogo({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 180.93 248.46"
            className={className}
            style={{ overflow: 'visible' }}
        >
            <defs>
                <style>{`
                    .cls-1    { fill: #f0f2e7; }
                    .cls-base { fill: currentColor; opacity: 0.85; }

                    .layer-2 { animation: sway 8s ease-in-out infinite;        transform-origin: 90px 193px; }
                    .layer-1 { animation: sway 8s ease-in-out infinite 0.25s;  transform-origin: 90px 137px; }
                    .layer-h { animation: sway 8s ease-in-out infinite 0.5s;   transform-origin: 90px 82px;  }

                    @keyframes sway {
                        0%,100% { transform: translateY(0px)   translateX(0px)    rotate(0deg);    }
                        20%     { transform: translateY(-6px)  translateX(0.5px)  rotate(-0.3deg); }
                        50%     { transform: translateY(-10px) translateX(-0.3px) rotate(0.2deg);  }
                        75%     { transform: translateY(-4px)  translateX(0.2px)  rotate(-0.1deg); }
                    }

                    .glow-2 { animation: shadow 8s ease-in-out infinite;       }
                    .glow-1 { animation: shadow 8s ease-in-out infinite 0.25s; }
                    .glow-h { animation: shadow 8s ease-in-out infinite 0.5s;  }

                    @keyframes shadow {
                        0%,100% { filter: drop-shadow(0 3px 6px rgba(0,0,0,0.5)); }
                        50%     { filter: drop-shadow(0 16px 28px rgba(0,0,0,0.7))
                                          drop-shadow(0 2px 14px rgba(74,222,128,0.12)); }
                    }

                    /* Dots in their own fixed layer — only LED animation, no position change */
                    .dot-2 { animation: led 4s ease-in-out infinite;      }
                    .dot-1 { animation: led 4s ease-in-out infinite 1.4s; }
                    .dot-h { animation: led 4s ease-in-out infinite 2.7s; }

                    @keyframes led {
                        0%   { fill: #4ade80; filter: drop-shadow(0 0 4px #4ade80) drop-shadow(0 0 10px #22c55e); }
                        30%  { fill: #4ade80; filter: drop-shadow(0 0 7px #4ade80) drop-shadow(0 0 16px #16a34a); }
                        50%  { fill: #facc15; filter: drop-shadow(0 0 5px #facc15) drop-shadow(0 0 12px #ca8a04); }
                        72%  { fill: #f87171; filter: drop-shadow(0 0 8px #f87171) drop-shadow(0 0 18px #dc2626); }
                        88%  { fill: #ef4444; filter: drop-shadow(0 0 12px #ef4444) drop-shadow(0 0 24px #b91c1c); }
                        96%  { fill: #1a1a1a; filter: none; }
                        100% { fill: #4ade80; filter: drop-shadow(0 0 4px #4ade80) drop-shadow(0 0 10px #22c55e); }
                    }

                    .tf2 { animation: ts 8s ease-in-out infinite;       }
                    .tf1 { animation: ts 8s ease-in-out infinite 0.25s; }
                    .tfh { animation: ts 8s ease-in-out infinite 0.5s;  }
                    @keyframes ts { 0%,100% { opacity:1; } 40% { opacity:0.8; } 55% { opacity:1; } }

                    .s  { animation: sb 8s ease-in-out infinite; }
                    .sb { animation: sb 8s ease-in-out infinite 0.25s; }
                    .sc { animation: sb 8s ease-in-out infinite 0.5s; }
                    @keyframes sb { 0%,100% { opacity:1; } 50% { opacity:0.77; } }

                    .layer-1 .cls-base { opacity: 0.80; }
                    .layer-h .cls-base { opacity: 0.72; }

                    .logo-root {
                        animation: rise 1s cubic-bezier(0.34,1.45,0.64,1) both;
                        transform-origin: 50% 50%;
                    }
                    @keyframes rise {
                        from { opacity:0; transform: translateY(20px) scale(0.85); }
                        to   { opacity:1; transform: translateY(0)    scale(1);    }
                    }
                `}</style>

                <linearGradient id="shimmer" x1="0%" y1="0%" x2="100%" y2="50%">
                    <stop offset="0%"   stopColor="#f0f2e7" stopOpacity="1" />
                    <stop offset="45%"  stopColor="#ffffff" stopOpacity="0.9" />
                    <stop offset="60%"  stopColor="#dde3d5" stopOpacity="0.65" />
                    <stop offset="100%" stopColor="#f0f2e7" stopOpacity="1" />
                </linearGradient>
                <clipPath id="c2"><polygon points="90.81 117.29 176.96 159.2 90.63 210.91 4.5 159.2"/></clipPath>
                <clipPath id="c1"><polygon points="90.94 58.62 177.09 103.17 90.76 154.88 4.63 103.17"/></clipPath>
                <clipPath id="ch"><polygon points="145.96 31.51 117.33 48.01 90.73 33.59 117.07 17.24 90.67 2.96 6.3 48.06 34.9 65.59 63.68 49.05 90.37 63.56 60.28 80.91 90.76 99.68 177.09 47.97"/></clipPath>
            </defs>

            <g className="logo-root">
                {/* RACK 2 — no dot */}
                <g className="layer-2 glow-2">
                    <path className="cls-base" d="M180.68,193.32l.12-33.68a4.48,4.48,0,0,0-2.43-4L92.88,112.2a4.42,4.42,0,0,0-4,0L2.57,155.67a4.44,4.44,0,0,0-2.45,4L0,193.28a4.45,4.45,0,0,0,2.2,3.86l86.26,50.7a4.45,4.45,0,0,0,4.53,0l85.51-50.7A4.46,4.46,0,0,0,180.68,193.32Z"/>
                    <polygon className="cls-1 s"   points="93.07 242.59 92.98 214.37 176.96 163.7 176.96 193.93 93.07 242.59"/>
                    <polygon className="cls-1 s"   points="88.39 242.59 88.47 214.37 4.5 163.7 4.5 193.93 88.39 242.59"/>
                    <polygon className="cls-1 tf2" points="90.81 117.29 176.96 159.2 90.63 210.91 4.5 159.2 90.81 117.29"/>
                    <rect x="-10" y="110" width="210" height="110" fill="url(#shimmer)" clipPath="url(#c2)" opacity="0.28" className="tf2"/>
                </g>

                {/* RACK 1 — no dot */}
                <g className="layer-1 glow-1">
                    <path className="cls-base" d="M180.81,137.29l.12-33.68a4.46,4.46,0,0,0-2.43-4L93,56.17a4.42,4.42,0,0,0-4,0L2.7,99.64a4.46,4.46,0,0,0-2.45,4L.13,137.25a4.47,4.47,0,0,0,2.2,3.86l86.27,50.7a4.44,4.44,0,0,0,4.52,0l85.51-50.7A4.44,4.44,0,0,0,180.81,137.29Z"/>
                    <polygon className="cls-1 sb"  points="93.2 186.56 93.12 158.34 177.09 107.67 177.09 137.9 93.2 186.56"/>
                    <polygon className="cls-1 sb"  points="88.52 186.56 88.61 158.34 4.63 107.67 4.63 137.9 88.52 186.56"/>
                    <polygon className="cls-1 tf1" points="90.94 58.62 177.09 103.17 90.76 154.88 4.63 103.17 90.94 58.62"/>
                    <rect x="-10" y="52" width="210" height="110" fill="url(#shimmer)" clipPath="url(#c1)" opacity="0.28" className="tf1"/>
                </g>

                {/* RACK H — no dot */}
                <g className="layer-h glow-h">
                    <path className="cls-base" d="M180.81,82.09l.12-33.68a4.43,4.43,0,0,0-2.43-4L145.83,27.82,121,41.81l.29-26.49L93,.48a4.45,4.45,0,0,0-4,0L3,45.06A4.49,4.49,0,0,0,.59,49L.65,81.43a4.47,4.47,0,0,0,2.2,3.86L35,104.65,55.46,93.11,55.63,117l33,19.66a4.44,4.44,0,0,0,4.52,0L178.63,85.9A4.44,4.44,0,0,0,180.81,82.09Z"/>
                    <polygon className="cls-1 sc"  points="93.2 131.36 93.12 103.14 177.09 52.47 177.09 82.7 93.2 131.36"/>
                    <polygon className="cls-1 sc"  points="88.52 131.98 88.61 102.28 59.29 84.58 59.29 114.78 88.52 131.98"/>
                    <polygon className="cls-1 sc"  points="36.9 99.68 55.52 89.15 55.63 78.73 61.9 75.16 62.09 54.79 36.9 69.18 36.9 99.68"/>
                    <polygon className="cls-1"     points="64.98 74.23 82.26 64.07 64.98 54.06 64.98 74.23"/>
                    <polygon className="cls-1"     points="117.07 43.95 97.85 33.84 117.07 22.51 117.07 43.95"/>
                    <polygon className="cls-1 sc"  points="33.24 98.97 33.33 69.28 4.63 51.36 4.63 81.56 33.24 98.97"/>
                    <polygon className="cls-1 tfh" points="145.96 31.51 117.33 48.01 90.73 33.59 117.07 17.24 90.67 2.96 6.3 48.06 34.9 65.59 63.68 49.05 90.37 63.56 60.28 80.91 90.76 99.68 177.09 47.97 145.96 31.51"/>
                    <rect x="-10" y="-5" width="210" height="115" fill="url(#shimmer)" clipPath="url(#ch)" opacity="0.28" className="tfh"/>
                </g>

                {/* DOTS — own fixed group, unaffected by rack transforms */}
                <ellipse className="dot-2" cx="17.9"  cy="186.47" rx="5.33" ry="6.77" transform="translate(-60.36 16.28) rotate(-19.21)"/>
                <ellipse className="dot-1" cx="18.04" cy="130.44" rx="5.33" ry="6.77" transform="translate(-41.92 13.2)  rotate(-19.21)"/>
                <ellipse className="dot-h" cx="18.04" cy="75.24"  rx="5.33" ry="6.77" transform="translate(-23.75 10.13) rotate(-19.21)"/>
            </g>
        </svg>
    )
}