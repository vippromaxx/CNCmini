/* Four local SVG instruments. Geometry is clamped; the readout keeps the measured value. */
(function (root) {
  'use strict';

  const defaults = {
    x: { label: 'Vị trí trục X', unit: 'mm', max: 230, decimals: 0 },
    y: { label: 'Vị trí trục Y', unit: 'mm', max: 850, decimals: 0 },
    temperature: { label: 'Nhiệt độ DHT11', unit: '°C', max: 60, decimals: 1 },
    humidity: { label: 'Độ ẩm DHT11', unit: '%', max: 100, decimals: 1 }
  };
  const number = value => (typeof value === 'number' || (typeof value === 'string' && value.trim()))
    && Number.isFinite(Number(value)) ? Number(value) : null;
  const format = (value, decimals = 0) => value.toLocaleString('vi-VN', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals
  });

  function reading(value, min, max) {
    const numeric = number(value);
    return {
      value: numeric,
      ratio: numeric === null ? 0 : Math.max(0, Math.min(1, (numeric - min) / (max - min))),
      outside: numeric !== null && (numeric < min || numeric > max)
    };
  }

  function point(cx, cy, radius, angle) {
    const radians = angle * Math.PI / 180;
    return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
  }

  function arc(cx, cy, radius, start, end) {
    const a = point(cx, cy, radius, start), b = point(cx, cy, radius, end);
    return `M ${a.join(' ')} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${b.join(' ')}`;
  }

  function tick(cx, cy, inner, outer, angle, major) {
    const a = point(cx, cy, inner, angle), b = point(cx, cy, outer, angle);
    return `<path class="gauge-tick${major ? ' gauge-tick-major' : ''}" d="M ${a.join(' ')} L ${b.join(' ')}"/>`;
  }

  function template(kind, id) {
    if (kind === 'x') {
      return `<circle class="gauge-dial-rim" cx="130" cy="101" r="94"/>
        <circle class="gauge-dial-face" cx="130" cy="101" r="87"/>
        <path class="gauge-rail" d="${arc(130, 101, 78, 150, 390)}"/>
        ${Array.from({ length: 41 }, (_, i) => tick(130, 101, i % 10 ? 73 : 66, 80, 150 + i * 6, i % 10 === 0)).join('')}
        ${[0, .25, .5, .75, 1].map((ratio, i) => {
          const [x, y] = point(130, 101, 54, 150 + ratio * 240);
          return `<text class="gauge-scale" data-scale="${ratio}" x="${x}" y="${y + 4}"></text>`;
        }).join('')}
        <g data-needle class="gauge-needle"><path d="M 120 97 L 196 101 L 120 105 Z"/></g>
        <circle class="gauge-hub" cx="130" cy="101" r="7"/>
        <circle class="gauge-hub-core" cx="130" cy="101" r="2"/>
        <text class="gauge-value" data-value x="130" y="215">--</text>
        <text class="gauge-unit" x="130" y="235">mm</text>`;
    }
    if (kind === 'y') {
      return `<path class="gauge-digital-guide" d="${arc(130, 111, 96, 150, 390)}"/>
        ${Array.from({ length: 32 }, (_, i) => `<path data-segment="${i}" class="gauge-segment" d="${arc(130, 111, 83, 150 + i * 7.5, 155.3 + i * 7.5)}"/>`).join('')}
        <path class="gauge-digital-inner" d="${arc(130, 111, 66, 150, 390)}"/>
        <text class="gauge-overline" x="130" y="85">VỊ TRÍ Y</text>
        <text class="gauge-value" data-value x="130" y="126">--</text>
        <text class="gauge-unit" x="130" y="148">mm</text>
        <text class="gauge-scale" data-scale="0" x="47" y="178"></text>
        <text class="gauge-scale" data-scale="1" x="213" y="178"></text>
        <rect class="gauge-digital-track" x="68" y="204" width="124" height="3" rx="1.5"/>
        <rect class="gauge-digital-fill" data-progress x="68" y="204" width="0" height="3" rx="1.5"/>
        <text class="gauge-unit" data-percent x="130" y="233">CHỜ DỮ LIỆU</text>`;
    }
    if (kind === 'temperature') {
      return `<defs><linearGradient id="${id}-heat" gradientUnits="userSpaceOnUse" x1="64" y1="187" x2="64" y2="37"><stop stop-color="#e7a254"/><stop offset="1" stop-color="#c65a32"/></linearGradient></defs>
        <path class="gauge-thermo-shell" d="M49 171 V37 A15 15 0 0 1 79 37 V171 A25 25 0 1 1 49 171Z"/>
        <path class="gauge-thermo-track" d="M64 39 V187"/>
        <path class="gauge-thermo-fill" data-heat stroke="url(#${id}-heat)" d="M64 187 V187"/>
        <circle class="gauge-thermo-bulb" data-bulb cx="64" cy="191" r="16"/>
        ${Array.from({ length: 13 }, (_, i) => `<path class="gauge-thermo-tick" d="M88 ${175 - i * 11.5} h${i % 2 ? 5 : 10}"/>`).join('')}
        <text class="gauge-scale" data-scale="1" x="110" y="40"></text>
        <text class="gauge-scale" data-scale="0" x="110" y="179"></text>
        <text class="gauge-overline" x="181" y="69">NHIỆT ĐỘ</text>
        <text class="gauge-value" data-value x="181" y="118">--</text>
        <text class="gauge-unit" x="181" y="144">°C</text>
        <path class="gauge-sensor-divider" d="M145 166 H217"/>
        <text class="gauge-unit" x="181" y="188">MÔI TRƯỜNG</text>
        <text class="gauge-overline" x="130" y="235">CẢM BIẾN DHT11</text>`;
    }
    return `<path class="gauge-humidity-track" d="${arc(130, 113, 82, 135, 405)}"/>
      ${Array.from({ length: 41 }, (_, i) => tick(130, 113, i % 5 ? 94 : 91, 98, 135 + i * 6.75, i % 5 === 0)).join('')}
      <path class="gauge-humidity-fill" data-humidity pathLength="100" stroke-dasharray="0 100" d="${arc(130, 113, 82, 135, 405)}"/>
      <circle class="gauge-humidity-marker" data-humidity-marker r="5"/>
      <path class="gauge-drop" d="M130 58 C127 63 122 67 122 72 A8 8 0 0 0 138 72 C138 67 133 63 130 58Z"/>
      <text class="gauge-value" data-value x="130" y="126">--</text>
      <text class="gauge-unit" x="130" y="149">% RH</text>
      <text class="gauge-scale" data-scale="0" x="70" y="196"></text>
      <text class="gauge-scale" data-scale="1" x="190" y="196"></text>
      <text class="gauge-overline" x="130" y="229">ĐỘ ẨM TƯƠNG ĐỐI</text>`;
  }

  function create(container, kind) {
    if (!container || !defaults[kind]) return null;
    const config = defaults[kind];
    container.innerHTML = `<svg viewBox="0 0 260 242" aria-hidden="true" focusable="false">${template(kind, container.id)}</svg>`;
    container.setAttribute('role', 'img');
    const card = container.closest('.gauge-card');
    const footer = card?.querySelector('[data-gauge-range]');
    const valueLabel = container.querySelector('[data-value]');
    const needle = container.querySelector('[data-needle]');
    const segments = [...container.querySelectorAll('[data-segment]')];
    const heat = container.querySelector('[data-heat]');
    const humidity = container.querySelector('[data-humidity]');
    let min = 0, max = config.max;

    function update(value, nextMin = min, nextMax = max) {
      const lower = number(nextMin), upper = number(nextMax);
      if (lower !== null && upper !== null && upper > lower) { min = lower; max = upper; }
      const sample = reading(value, min, max);
      const valid = sample.value !== null;
      const text = valid ? format(sample.value, config.decimals) : '--';
      valueLabel.textContent = text;
      card?.classList.toggle('gauge-no-data', !valid);
      card?.classList.toggle('gauge-outside-range', sample.outside);
      container.setAttribute('aria-label', `${config.label}: ${valid ? `${text} ${config.unit}` : 'Chưa có dữ liệu'}. Thang đo ${format(min)} đến ${format(max)} ${config.unit}${sample.outside ? '. Ngoài thang đo' : ''}`);
      container.querySelectorAll('[data-scale]').forEach(label => {
        label.textContent = format(min + (max - min) * Number(label.dataset.scale));
      });
      if (footer) footer.textContent = sample.outside ? 'Ngoài thang đo' : `${format(min)} — ${format(max)} ${config.unit}`;
      if (needle) {
        needle.setAttribute('transform', `rotate(${150 + sample.ratio * 240} 130 101)`);
        needle.style.opacity = valid ? '1' : '0';
      }
      segments.forEach((segment, i) => segment.classList.toggle('is-filled', valid && i < Math.ceil(sample.ratio * segments.length)));
      if (kind === 'y') {
        container.querySelector('[data-progress]').setAttribute('width', String(124 * sample.ratio));
        container.querySelector('[data-percent]').textContent = valid ? `${format(sample.ratio * 100)}% HÀNH TRÌNH` : 'CHỜ DỮ LIỆU';
      }
      if (heat) {
        heat.setAttribute('d', `M64 187 V${175 - 138 * sample.ratio}`);
        heat.style.opacity = valid ? '1' : '0';
        container.querySelector('[data-bulb]').style.opacity = valid ? '1' : '0';
      }
      if (humidity) {
        humidity.setAttribute('stroke-dasharray', `${sample.ratio * 100} 100`);
        humidity.style.opacity = valid && sample.ratio > 0 ? '1' : '0';
        const marker = container.querySelector('[data-humidity-marker]');
        const [x, y] = point(130, 113, 82, 135 + sample.ratio * 270);
        marker.setAttribute('cx', x);
        marker.setAttribute('cy', y);
        marker.style.opacity = valid ? '1' : '0';
      }
    }
    update(null);
    return { update };
  }

  root.MiniCncGauges = { create };
})(typeof window === 'undefined' ? globalThis : window);
