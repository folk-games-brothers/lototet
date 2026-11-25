/* Local, copyright-free Vietnamese callouts for browser speech synthesis. */
(function exposeAnnouncer(root) {
  const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  const callouts = [
    (number) => `Bà con ơi, con số ${number}!`,
    (number) => `Lộc xuân lên tiếng, số ${number}!`,
    (number) => `Ai có số này giơ tay nào: ${number}!`,
    (number) => `Số ${number} vừa ghé sân khấu!`,
  ];
  const styles = [
    { id: 'random', label: 'Ngẫu nhiên', rate: 0.95, pitch: 1.05, callout: null },
    { id: 'pop', label: 'Pop vui', rate: 1.08, pitch: 1.22, callout: (n) => `Pop lên nào, số ${n}!` },
    { id: 'rap', label: 'Rap nhịp', rate: 1.18, pitch: 0.88, callout: (n) => `Bắt nhịp theo tôi — số ${n}, lên!` },
    { id: 'bolero', label: 'Bolero', rate: 0.82, pitch: 0.96, callout: (n) => `Êm đềm ngày xuân, con số ${n} đây rồi.` },
    { id: 'stage', label: 'MC sân khấu', rate: 0.95, pitch: 1.05, callout: (n) => `Xin mời sân khấu gọi tên: số ${n}!` },
  ];

  function numberToVietnamese(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 90) {
      throw new RangeError('Số lô tô phải nằm trong khoảng 0 đến 90.');
    }
    if (number < 10) return digits[number];

    const tens = Math.floor(number / 10);
    const ones = number % 10;
    const tensText = tens === 1 ? 'mười' : `${digits[tens]} mươi`;
    if (ones === 0) return tensText;
    const onesText = ones === 1 && tens > 1 ? 'mốt' : ones === 5 ? 'lăm' : digits[ones];
    return `${tensText} ${onesText}`;
  }

  function numberCallout(value, styleIndex = Math.floor(Math.random() * callouts.length)) {
    const requestedStyle = Number.isFinite(Number(styleIndex)) ? Math.trunc(Number(styleIndex)) : 0;
    const index = ((requestedStyle % callouts.length) + callouts.length) % callouts.length;
    return callouts[index](numberToVietnamese(value));
  }

  function announcement(value, styleIndex = 0) {
    const number = numberToVietnamese(value);
    const index = ((Math.trunc(Number(styleIndex) || 0) % styles.length) + styles.length) % styles.length;
    const style = styles[index];
    return {
      text: style.callout ? style.callout(number) : numberCallout(value),
      rate: style.rate,
      pitch: style.pitch,
      style: style.id,
    };
  }

  const api = { numberToVietnamese, numberCallout, styles: styles.map(({ id, label, rate, pitch }) => ({ id, label, rate, pitch })), announcement };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LotoAnnouncer = api;
})(typeof window !== 'undefined' ? window : globalThis);
