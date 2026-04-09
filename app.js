const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

let mediaRecorder = null;
let audioChunks = [];
let timerInterval = null;
let seconds = 0;
let audioContext = null;
let analyserNode = null;
let animationId = null;
let currentSummary = '';
let currentTranscript = '';

const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const keyStatus = document.getElementById('keyStatus');
const slackUrlInput = document.getElementById('slackUrlInput');
const saveSlackBtn = document.getElementById('saveSlackBtn');
const slackStatus = document.getElementById('slackStatus');
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const timerEl = document.getElementById('timer');
const statusSection = document.getElementById('statusSection');
const statusText = document.getElementById('statusText');
const progressFill = document.getElementById('progressFill');
const resultSection = document.getElementById('resultSection');
const summaryTab = document.getElementById('summaryTab');
const transcriptTab = document.getElementById('transcriptTab');
const slackBtn = document.getElementById('slackBtn');
const copyBtn = document.getElementById('copyBtn');
const resetBtn = document.getElementById('resetBtn');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

// Load saved settings
if (localStorage.getItem('gemini_api_key')) {
    apiKeyInput.value = localStorage.getItem('gemini_api_key');
    keyStatus.textContent = '✅ 저장됨';
}
if (localStorage.getItem('slack_webhook_url')) {
    slackUrlInput.value = localStorage.getItem('slack_webhook_url');
    slackStatus.textContent = '✅ 저장됨';
}

function getApiKey() { return localStorage.getItem('gemini_api_key') || ''; }
function getSlackUrl() { return localStorage.getItem('slack_webhook_url') || ''; }

saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) return;
    localStorage.setItem('gemini_api_key', key);
    keyStatus.textContent = '✅ 저장됨';
});

saveSlackBtn.addEventListener('click', () => {
    const url = slackUrlInput.value.trim();
    if (!url) return;
    localStorage.setItem('slack_webhook_url', url);
    slackStatus.textContent = '✅ 저장됨';
});

recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
slackBtn.addEventListener('click', sendToSlack);
copyBtn.addEventListener('click', copyResult);
resetBtn.addEventListener('click', resetAll);

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        summaryTab.hidden = tab.dataset.tab !== 'summary';
        transcriptTab.hidden = tab.dataset.tab !== 'transcript';
    });
});

async function startRecording() {
    if (!getApiKey()) { showToast('먼저 Gemini API 키를 입력해주세요'); return; }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];
        mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
        mediaRecorder.onstop = handleRecordingComplete;
        mediaRecorder.start();
        setupVisualizer(stream);
        startTimer();
        recordBtn.classList.add('recording');
        recordBtn.innerHTML = '<span class="record-icon"></span> 녹음 중...';
        recordBtn.disabled = true;
        stopBtn.disabled = false;
    } catch (err) { showToast('마이크 접근 권한이 필요합니다'); }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    stopTimer();
    if (animationId) cancelAnimationFrame(animationId);
    recordBtn.classList.remove('recording');
    recordBtn.innerHTML = '<span class="record-icon"></span> 녹음 시작';
    recordBtn.disabled = false;
    stopBtn.disabled = true;
}

async function handleRecordingComplete() {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    statusSection.hidden = false;
    resultSection.hidden = true;
    statusText.textContent = '음성을 텍스트로 변환 중...';
    progressFill.style.width = '20%';
    try {
        const base64Audio = await blobToBase64(blob);
        progressFill.style.width = '40%';
        statusText.textContent = '음성 인식 중...';
        const transcript = await callGemini(
            '이 음성 파일의 내용을 한국어로 정확하게 받아적어주세요. 화자 구분이 가능하면 구분해주세요. 받아적기만 하고 요약하지 마세요.',
            base64Audio
        );
        currentTranscript = transcript;
        transcriptTab.textContent = transcript;
        statusText.textContent = 'AI 분석 중...';
        progressFill.style.width = '70%';
        const summary = await callGeminiText(
            '당신은 회의록 분석 전문가입니다. 다음 녹취록을 분석해서 한국어로 작성해주세요:\n\n## 회의 요약\n(3-5문장)\n\n## 주요 논의 사항\n- 항목\n\n## 액션 아이템\n- [ ] 할일 (담당자, 기한)\n\n## 결정 사항\n- 결정\n\n녹취록:\n' + transcript
        );
        currentSummary = summary;
        summaryTab.textContent = summary;
        progressFill.style.width = '100%';
        setTimeout(() => { statusSection.hidden = true; resultSection.hidden = false; }, 400);

        // 자동 Slack 전송
        if (getSlackUrl()) {
            statusText.textContent = 'Slack 전송 중...';
            await doSendSlack(summary);
        }
    } catch (err) {
        statusText.textContent = '오류: ' + (err.message || '다시 시도해주세요');
        progressFill.style.width = '0%';
    }
}

function blobToBase64(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
    });
}

async function callGemini(prompt, audioBase64) {
    const resp = await fetch(GEMINI_API_URL + '?key=' + getApiKey(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [
                { inline_data: { mime_type: 'audio/webm', data: audioBase64 } },
                { text: prompt }
            ]}]
        })
    });
    if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message || 'API 오류'); }
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text;
}

async function callGeminiText(prompt) {
    const resp = await fetch(GEMINI_API_URL + '?key=' + getApiKey(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message || 'API 오류'); }
    const data = await resp.json();
    return data.candidates[0].content.parts[0].text;
}

async function doSendSlack(summary) {
    const url = getSlackUrl();
    if (!url) return false;
    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: ':memo: *회의록 자동 분석 결과*\n\n' + summary
            })
        });
        showToast('Slack 전송 완료!');
        return true;
    } catch (err) {
        showToast('Slack 전송 실패');
        return false;
    }
}

async function sendToSlack() {
    if (!getSlackUrl()) { showToast('Slack Webhook URL을 먼저 설정해주세요'); return; }
    if (!currentSummary) { showToast('분석 결과가 없습니다'); return; }
    slackBtn.disabled = true;
    slackBtn.textContent = '전송 중...';
    await doSendSlack(currentSummary);
    slackBtn.disabled = false;
    slackBtn.textContent = '💬 Slack 전송';
}

function copyResult() {
    navigator.clipboard.writeText(currentSummary);
    showToast('클립보드에 복사됨');
}

function resetAll() {
    resultSection.hidden = true;
    statusSection.hidden = true;
    seconds = 0;
    timerEl.textContent = '00:00';
    currentSummary = '';
    currentTranscript = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function startTimer() {
    seconds = 0;
    timerInterval = setInterval(() => {
        seconds++;
        const m = String(Math.floor(seconds / 60)).padStart(2, '0');
        const s = String(seconds % 60).padStart(2, '0');
        timerEl.textContent = m + ':' + s;
    }, 1000);
}

function stopTimer() { clearInterval(timerInterval); }

function setupVisualizer(stream) {
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    source.connect(analyserNode);
    drawWaveform();
}

function drawWaveform() {
    const buf = analyserNode.frequencyBinCount;
    const data = new Uint8Array(buf);
    analyserNode.getByteFrequencyData(data);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bw = (canvas.width / buf) * 2;
    let x = 0;
    for (let i = 0; i < buf; i++) {
        const h = (data[i] / 255) * canvas.height;
        const g = ctx.createLinearGradient(0, canvas.height, 0, 0);
        g.addColorStop(0, '#6C5CE7');
        g.addColorStop(1, '#A29BFE');
        ctx.fillStyle = g;
        ctx.fillRect(x, canvas.height - h, bw - 1, h);
        x += bw;
    }
    animationId = requestAnimationFrame(drawWaveform);
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.hidden = false;
    setTimeout(() => { t.hidden = true; }, 2500);
}
