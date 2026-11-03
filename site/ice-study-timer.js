(() => {
  const minSeconds = 5 * 60;
  const maxSeconds = 15 * 60;
  const clock = document.querySelector('#clock');
  const startBtn = document.querySelector('#startBtn');
  const resetBtn = document.querySelector('#resetBtn');
  const progress = document.querySelector('#progress');
  const statusLabel = document.querySelector('#statusLabel');
  const elapsedLabel = document.querySelector('#elapsedLabel');
  const iceCaption = document.querySelector('#iceCaption');
  const encouragement = document.querySelector('#encouragement');
  const soundBtn = document.querySelector('#soundBtn');
  let duration = 0;
  let remaining = 0;
  let running = false;
  let interval = null;
  let soundOn = false;

  function chooseTime() {
    duration = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
    remaining = duration;
    running = false;
    clearInterval(interval);
    document.body.classList.remove('running', 'finished');
    document.body.style.removeProperty('--melt');
    document.body.style.removeProperty('--size');
    document.body.style.removeProperty('--water-rise');
    statusLabel.textContent = 'ICE IS CHILLING';
    iceCaption.textContent = 'YOUR ICE CUBE IS READY';
    encouragement.textContent = 'One small session is still a win. What are you working on?';
    startBtn.innerHTML = 'Start studying <span>→</span>';
    draw();
  }

  function draw() {
    const mins = Math.floor(remaining / 60).toString().padStart(2, '0');
    const secs = (remaining % 60).toString().padStart(2, '0');
    clock.textContent = `${mins}:${secs}`;
    const pct = ((duration - remaining) / duration) * 100;
    progress.style.width = `${pct}%`;
    elapsedLabel.textContent = `${Math.round(pct)}% MELTED`;
    document.body.style.setProperty('--melt', `${pct * 0.54}px`);
    document.body.style.setProperty('--size', `${1 - pct * 0.004}`);
    document.body.style.setProperty('--water-rise', `${pct * 0.13}%`);
  }

  function finish() {
    running = false;
    clearInterval(interval);
    remaining = 0;
    draw();
    document.body.classList.remove('running');
    document.body.classList.add('finished');
    statusLabel.textContent = 'TIME TO TAKE A BREATHER';
    iceCaption.textContent = 'YOUR ICE CUBE HAS MELTED';
    encouragement.textContent = 'Nice work showing up. Take a little break, then go again if you like.';
    startBtn.innerHTML = 'Start another round <span>→</span>';
    if (soundOn) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [660, 880].forEach((frequency, index) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.frequency.value = frequency;
          gain.gain.setValueAtTime(0.001, ctx.currentTime + index * 0.18);
          gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + index * 0.18 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + index * 0.18 + 0.32);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + index * 0.18);
          osc.stop(ctx.currentTime + index * 0.18 + 0.34);
        });
      } catch (_) { /* Audio can be unavailable in some browsers. */ }
    }
  }

  function start() {
    if (remaining === 0) chooseTime();
    running = !running;
    if (running) {
      document.body.classList.add('running');
      statusLabel.textContent = 'FOCUS TIME';
      iceCaption.textContent = 'MELTING A LITTLE AT A TIME';
      encouragement.textContent = 'You’ve got this. Keep your attention on the next small step.';
      startBtn.innerHTML = 'Pause timer <span>Ⅱ</span>';
      interval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) finish();
        else draw();
      }, 1000);
    } else {
      clearInterval(interval);
      document.body.classList.remove('running');
      statusLabel.textContent = 'PAUSED FOR A MOMENT';
      iceCaption.textContent = 'ICE TAKES A BREATHER TOO';
      encouragement.textContent = 'Paused. Start again whenever you’re ready.';
      startBtn.innerHTML = 'Keep studying <span>→</span>';
    }
  }

  startBtn.addEventListener('click', start);
  resetBtn.addEventListener('click', chooseTime);
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.textContent = soundOn ? '♫  SOUND ON' : '♫  SOUND OFF';
    soundBtn.setAttribute('aria-pressed', String(soundOn));
  });
  chooseTime();
})();
