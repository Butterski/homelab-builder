export function AnimatedLogo({ className }: { className?: string }) {
    return (
        <svg 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 180.93 248.46" 
            className={className}
        >
            <defs>
                <style>
                    {`
                    .cls-1 { fill: #f0f2e7; }
                    .cls-2 { fill: #8bab89; }
                    .cls-base { fill: currentColor; }
                    .layer-2 { animation: float 6s ease-in-out infinite; transform-origin: center; }
                    .layer-1 { animation: float 6s ease-in-out infinite 0.4s; transform-origin: center; }
                    .layer-h { animation: float 6s ease-in-out infinite 0.8s; transform-origin: center; }
                    @keyframes float {
                        0% { transform: translateY(0px); }
                        50% { transform: translateY(-12px); }
                        100% { transform: translateY(0px); }
                    }
                    `}
                </style>
            </defs>
            <g id="Layer2" className="layer-2">
                <path className="cls-base" d="M180.68,193.32l.12-33.68a4.48,4.48,0,0,0-2.43-4L92.88,112.2a4.42,4.42,0,0,0-4,0L2.57,155.67a4.44,4.44,0,0,0-2.45,4L0,193.28a4.45,4.45,0,0,0,2.2,3.86l86.26,50.7a4.45,4.45,0,0,0,4.53,0l85.51-50.7A4.46,4.46,0,0,0,180.68,193.32Z"/>
                <polygon className="cls-1" points="93.07 242.59 92.98 214.37 176.96 163.7 176.96 193.93 93.07 242.59"/>
                <polygon className="cls-1" points="88.39 242.59 88.47 214.37 4.5 163.7 4.5 193.93 88.39 242.59"/>
                <polygon className="cls-1" points="90.81 117.29 176.96 159.2 90.63 210.91 4.5 159.2 90.81 117.29"/>
                <ellipse className="cls-2" cx="17.9" cy="186.47" rx="5.33" ry="6.77" transform="translate(-60.36 16.28) rotate(-19.21)"/>
            </g>
            <g id="Layer1" className="layer-1">
                <path className="cls-base" d="M180.81,137.29l.12-33.68a4.46,4.46,0,0,0-2.43-4L93,56.17a4.42,4.42,0,0,0-4,0L2.7,99.64a4.46,4.46,0,0,0-2.45,4L.13,137.25a4.47,4.47,0,0,0,2.2,3.86l86.27,50.7a4.44,4.44,0,0,0,4.52,0l85.51-50.7A4.44,4.44,0,0,0,180.81,137.29Z"/>
                <polygon className="cls-1" points="93.2 186.56 93.12 158.34 177.09 107.67 177.09 137.9 93.2 186.56"/>
                <polygon className="cls-1" points="88.52 186.56 88.61 158.34 4.63 107.67 4.63 137.9 88.52 186.56"/>
                <polygon className="cls-1" points="90.94 58.62 177.09 103.17 90.76 154.88 4.63 103.17 90.94 58.62"/>
                <ellipse className="cls-2" cx="18.04" cy="130.44" rx="5.33" ry="6.77" transform="translate(-41.92 13.2) rotate(-19.21)"/>
            </g>
            <g id="H" className="layer-h">
                <path className="cls-base" d="M180.81,82.09l.12-33.68a4.43,4.43,0,0,0-2.43-4L145.83,27.82,121,41.81l.29-26.49L93,.48a4.45,4.45,0,0,0-4,0L3,45.06A4.49,4.49,0,0,0,.59,49L.65,81.43a4.47,4.47,0,0,0,2.2,3.86L35,104.65,55.46,93.11,55.63,117l33,19.66a4.44,4.44,0,0,0,4.52,0L178.63,85.9A4.44,4.44,0,0,0,180.81,82.09Z"/>
                <polygon className="cls-1" points="93.2 131.36 93.12 103.14 177.09 52.47 177.09 82.7 93.2 131.36"/>
                <polygon className="cls-1" points="88.52 131.98 88.61 102.28 59.29 84.58 59.29 114.78 88.52 131.98"/>
                <polygon className="cls-1" points="36.9 99.68 55.52 89.15 55.63 78.73 61.9 75.16 62.09 54.79 36.9 69.18 36.9 99.68"/>
                <polygon className="cls-1" points="64.98 74.23 82.26 64.07 64.98 54.06 64.98 74.23"/>
                <polygon className="cls-1" points="117.07 43.95 97.85 33.84 117.07 22.51 117.07 43.95"/>
                <polygon className="cls-1" points="33.24 98.97 33.33 69.28 4.63 51.36 4.63 81.56 33.24 98.97"/>
                <polygon className="cls-1" points="145.96 31.51 117.33 48.01 90.73 33.59 117.07 17.24 90.67 2.96 6.3 48.06 34.9 65.59 63.68 49.05 90.37 63.56 60.28 80.91 90.76 99.68 177.09 47.97 145.96 31.51"/>
                <ellipse className="cls-2" cx="18.04" cy="75.24" rx="5.33" ry="6.77" transform="translate(-23.75 10.13) rotate(-19.21)"/>
            </g>
        </svg>
    )
}
