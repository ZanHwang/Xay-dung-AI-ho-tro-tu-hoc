// Stationery lying along the bottom of the Hôm nay and Môn học pages: ruler,
// pencil, eraser and two paper clips. Decoration only.
const TICKS = Array.from({ length: 77 }, (_, i) => {
  const length = i % 10 === 0 ? 16 : i % 5 === 0 ? 12 : 7;
  return `M${56 + i * 8} 74v${length}`;
}).join("");

export function DeskStrip() {
  return (
    <div className="desk" aria-hidden="true">
      <svg viewBox="0 0 1400 132" preserveAspectRatio="xMidYMax meet">
        <g transform="rotate(-1.2 360 94)">
          <rect x="40" y="74" width="640" height="38" rx="5" fill="#FFE391" stroke="#EDB415" strokeWidth="1.5" />
          <path d={TICKS} stroke="#B98A00" strokeWidth="1.2" fill="none" />
          {Array.from({ length: 8 }, (_, i) => (
            <text key={i} x={56 + i * 80} y="102" fontSize="12" textAnchor="middle" fill="#8A6200">{i}</text>
          ))}
        </g>
        <g transform="rotate(-4 900 92)">
          <rect x="736" y="80" width="250" height="26" fill="#79B342" />
          <rect x="736" y="89" width="250" height="8" fill="#8FC558" />
          <path d="M986 80l46 13-46 13z" fill="#F4D5AC" />
          <path d="M1018 89l14 4-14 4z" fill="#3A433E" />
          <rect x="718" y="80" width="18" height="26" fill="#C3CBC6" />
          <path d="M722 80v26M730 80v26" stroke="#8F9A94" fill="none" />
          <rect x="694" y="80" width="24" height="26" rx="6" fill="#FFB3A7" />
        </g>
        <g transform="rotate(7 1130 92)">
          <rect x="1088" y="70" width="86" height="44" rx="8" fill="#C2E5F7" stroke="#4BA8DA" strokeWidth="1.5" />
          <rect x="1088" y="70" width="30" height="44" rx="8" fill="#4BA8DA" />
        </g>
        <g fill="none" strokeWidth="3" strokeLinecap="round">
          <path transform="translate(1228 62) rotate(24)" d="M6 12v30a8 8 0 0 0 16 0V8a11 11 0 0 0-22 0v36" stroke="#9A82E3" />
          <path transform="translate(1292 80) rotate(-38)" d="M6 12v22a7 7 0 0 0 14 0V8a10 10 0 0 0-20 0v28" stroke="#EE7A68" />
        </g>
      </svg>
    </div>
  );
}
