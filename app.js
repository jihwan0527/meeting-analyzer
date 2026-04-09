const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

let mediaRecorder, audioChunks = [], timerInterval, seconds = 0;
let audioContext, analyserNode, animationId;
let currentSummary = '', currentTranscript = '';

const $ = id => document.getElementById(id);
const apiKeyInput = apiKeyInput, slackUrlInput = slackUrlInput;
const settingsToggle = settingsToggle, settingsPanel = settingsPanel, settingsBadge = settingsBadge;
const timerEl = timer, statusSection = statusSection, statusText = statusText;
const progressBar = progressBar, resultSection = resultSection;
const summaryTab = summaryTab, transcriptTab = transcriptTab;
const recordBtn = recordBtn, stopBtn = stopBtn;
const slackBtn = slackBtn, copyBtn = copyBtn, resetBtn = resetBtn;
const canvas = visualizer, ctx = canvas.getContext('2d');

// --- Settings ---
function getKey() { return localStorage.getItem('gemini_key') || ''; }
function getSlack() { return localStorage.getItem('slack_url') || ''; }

function loadSettings() {
    if (getKey()) apiKeyInput.value = getKey();
    if (getSlack()) slackUrlInput.value = getSlack();
    settingsBadge.hidden = !!(getKey());
    if (!getKey()) settingsPanel.hidden = false;
}
loadSettings();

settingsToggle.addEventListener('click', () => {
    settingsPanel.hidden = !settingsPanel.hidden;
});

saveSettingsBtn.addEventListener('click', () => {
    const k = apiKeyInput.value.trim();
    const s = slackUrlInput.value.trim();
    if (k) localStorage.setItem('gemini_key', k);
    if (s) localStorage.setItem('slack_url', s);
    settingsBadge.hidden = true;
    settingsPanel.hidden = true;
    showToast('설정이 저장되었습니다');
});

toggleKeyVis.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
});
toggleSlackVis.addEventListener('click', () => {
    slackUrlInput.type = slackUrlInput.type === 'password' ? 'text' : 'password';
});

// --- Tabs ---
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        summaryTab.hidden = tab.dataset.tab !== 'summary';
        transcriptTab.hidden = tab.dataset.tab !== 'transcript';
    });
});

// --- Recording ---
recordBtn.addEventListener('click', startRec);
stopBtn.addEventListener('click', stopRec);
slackBtn.addEventListener('click', manualSlack);
copyBtn.addEventListener('click', () => { navigator.clipboard.writeText(currentSummary); showToast('복사됨'); });
resetBtn.addEventListener('click', resetAll);

async function startRec() {
    if (!getKey()) { showToast('설정에서 Gemini API 키를 입력해주세요'); settingsPanel.hidden = false; return; }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];
        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = onRecordDone;
        mediaRecorder.start();
        setupVis(stream);
        startTimer();
        recordBtn.classList.add('recording');
        recordBtn.innerHTML = '<span class="rec-dot"></span> 녹음 중...';
        recordBtn.disabled = true;
        stopBtn.disabled = false;
    } catch (e) { showToast('마이크 접근 권한이 필요합니다'); }
}

function stopRec() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    stopTimer();
    if (animationId) cancelAnimationFrame(animationId);
    recordBtn.classList.remove('recording');
    recordBtn.innerHTML = '<span class="rec-dot"></span> 녹음 시작';
    recordBtn.disabled = false;
    stopBtn.disabled = true;
}

async function onRecordDone() {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    statusSection.hidden = false;
    resultSection.hidden = true;
    statusText.textContent = '음성 인식 중...';
    progressBar.style.width = '25%';
    try {
        const b64 = await toBase64(blob);
        progressBar.style.width = '45%';
        const transcript = await geminiAudio('이 음성 파일의 내용을 한국어로 정확하게 받아적어주세요. 화자 구분이 가능하면 구분해주세요. 받아적기만 하고 요약하지 마세요.', b64);
        currentTranscript = transcript;
        transcriptTab.textContent = transcript;
        statusText.textContent = 'AI 분석 중...';
        progressBar.style.width = '70%';
        const summary = await geminiText('당신은 회의록 분석 전문가입니다. 다음 녹취록을 분석해서 한국어로 작성해주세요:\n\n## 회의 요약\n(3-5문장)\n\n## 주요 논의 사항\n- 항목\n\n## 액션 아이템\n- [ ] 할일 (담당자, 기한)\n\n## 결정 사항\n- 결정\n\n녹취록:\n' + transcript);
        currentSummary = summary;
        summaryTab.textContent = summary;
        progressBar.style.width = '100%';
        setTimeout(() => { statusSection.hidden = true; resultSection.hidden = false; }, 400);
        if (getSlack()) { await doSlack(summary); }
    } catch (err) {
        statusText.textContent = '오류: ' + (err.message || '다시 시도해주세요');
        progressBar.style.width = '0%';
    }
}

function toBase64(blob) {
    return new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
}

async function geminiAudio(prompt, b64) {
    const r = await fetch(GEMINI_URL + '?key=' + getKey(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: 'audio/webm', data: b64 } }, { text: prompt }] }] })
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'API 오류'); }
    return (await r.json()).candidates[0].content.parts[0].text;
}

async function geminiText(prompt) {
    const r = await fetch(GEMINI_URL + '?key=' + getKey(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error?.message || 'API 오류'); }
    return (await r.json()).candidates[0].content.parts[0].text;
}

async function doSlack(text) {
    try {
        await fetch(getSlack(), { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: ':memo: *회의록 자동 분석 결과*\n\n' + text }) });
        showToast('Slack 전송 완료!');
    } catch { showToast('Slack 전송 실패'); }
}

async function manualSlack() {
    if (!getSlack()) { showToast('설정에서 Slack Webhook URL을 입력해주세요'); settingsPanel.hidden = false; return; }
    if (!currentSummary) { showToast('분석 결과가 없습니다'); return; }
    slackBtn.disabled = true; slackBtn.textContent = '전송 중...';
    await doSlack(currentSummary);
    slackBtn.disabled = false; slackBtn.textContent = '💬 Slack 전송';
}

function resetAll() {
    resultSection.hidden = true; statusSection.hidden = true;
    seconds = 0; timerEl.textContent = '00:00';
    currentSummary = ''; currentTranscript = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function startTimer() {
    seconds = 0;
    timerInterval = setInterval(() => {
        seconds++;
        timerEl.textContent = String(Math.floor(seconds/60)).padStart(2,'0') + ':' + String(seconds%60).padStart(2,'0');
    }, 1000);
}

function stopTimer() { clearInterval(timerInterval); }

function setupVis(stream) {
    audioContext = new AudioContext();
    const src = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    src.connect(analyserNode);
    drawVis();
}

function drawVis() {
    const n = analyserNode.frequencyBinCount, d = new Uint8Array(n);
    analyserNode.getByteFrequencyData(d);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bw = (canvas.width / n) * 2.5;
    let x = 0;
    for (let i = 0; i < n; i++) {
        const h = (d[i] / 255) * canvas.height;
        const g = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - h);
        g.addColorStop(0, '#6C5CE7');
        g.addColorStop(1, '#C4B5FD');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(x, canvas.height - h, bw - 2, h, 3);
        ctx.fill();
        x += bw;
    }
    animationId = requestAnimationFrame(drawVis);
}

function showToast(msg) {
    const t = toast;
    t.textContent = msg; t.hidden = false;
    setTimeout(() => { t.hidden = true; }, 2500);
}
