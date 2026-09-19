document.addEventListener('DOMContentLoaded', () => {
  const btnGetOTP = document.getElementById('btn-get-otp');
  const loader = document.getElementById('loader');
  const otpDisplay = document.getElementById('otp-display');
  const btnCopy = document.getElementById('btn-copy');
  const copyText = document.getElementById('copy-text');
  const statusBadge = document.getElementById('status-badge');
  const timeBadge = document.getElementById('time-badge');

  const otpDetails = document.getElementById('otp-details');
  const detailFrom = document.getElementById('detail-from');
  const detailSubject = document.getElementById('detail-subject');
  const detailSnippet = document.getElementById('detail-snippet');

  const btnToggleFilter = document.getElementById('btn-toggle-filter');
  const filterPanel = document.getElementById('filter-panel');
  const filterSender = document.getElementById('filter-sender');
  const filterSubject = document.getElementById('filter-subject');
  const filterRegex = document.getElementById('filter-regex');

  const historyBody = document.getElementById('history-body');
  const btnClearLogs = document.getElementById('btn-clear-logs');

  let historyLogs = [];

  // Play Beep Sound
  const playSuccessSound = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  };

  // Toast System
  const showToast = (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  };

  // Toggle Filter Panel
  btnToggleFilter.addEventListener('click', () => {
    filterPanel.classList.toggle('hidden');
  });

  // HÀM CHÍNH: Lấy Mã OTP từ Express Server + Gmail API
  const fetchOTP = async () => {
    btnGetOTP.disabled = true;
    loader.classList.remove('hidden');

    statusBadge.textContent = 'Đang đọc Gmail...';
    statusBadge.style.background = 'rgba(59, 130, 246, 0.2)';
    statusBadge.style.color = '#60a5fa';

    try {
      const response = await fetch('/api/get-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderFilter: filterSender.value.trim(),
          subjectFilter: filterSubject.value.trim(),
          customRegex: filterRegex.value.trim()
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        showToast(data.message || 'Không lấy được mã OTP', 'error');
        statusBadge.textContent = 'Thất bại';
        statusBadge.style.background = 'rgba(244, 63, 94, 0.2)';
        statusBadge.style.color = '#f43f5e';
        return;
      }

      if (data.code) {
        otpDisplay.textContent = data.code;
        btnCopy.disabled = false;

        statusBadge.textContent = 'Thành công ✨';
        statusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
        statusBadge.style.color = '#10b981';

        const now = new Date();
        timeBadge.textContent = `Vừa lấy lúc ${now.toLocaleTimeString()}`;

        detailFrom.textContent = data.from || '-';
        detailSubject.textContent = data.subject || '-';
        detailSnippet.textContent = data.snippet || '-';
        otpDetails.classList.remove('hidden');

        // Tự động sao chép mã OTP vào Clipboard ngay lập tức
        navigator.clipboard.writeText(data.code);
        copyText.textContent = 'Đã Sao Chép!';
        setTimeout(() => { copyText.textContent = 'Sao Chép Mã'; }, 2000);

        playSuccessSound();
        showToast(`Đã lấy & sao chép mã OTP: ${data.code}`);

        addHistoryLog({
          code: data.code,
          time: now.toLocaleTimeString(),
          from: data.from,
          subject: data.subject
        });
      } else {
        showToast('Đã đọc email nhưng không phát hiện mã OTP.', 'error');
      }

    } catch (err) {
      showToast('Lỗi kết nối tới Server: ' + err.message, 'error');
    } finally {
      btnGetOTP.disabled = false;
      loader.classList.add('hidden');
    }
  };

  btnGetOTP.addEventListener('click', fetchOTP);

  // Phím tắt Space hoặc Enter
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    const isInput = activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA';
    if (!isInput && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      fetchOTP();
    }
  });

  // Sao chép mã
  btnCopy.addEventListener('click', () => {
    const code = otpDisplay.textContent;
    if (code && code !== '------') {
      navigator.clipboard.writeText(code);
      copyText.textContent = 'Đã Sao Chép!';
      showToast(`Đã copy mã: ${code}`);
      setTimeout(() => { copyText.textContent = 'Sao Chép Mã'; }, 2000);
    }
  });

  // History Log Table
  const addHistoryLog = (item) => {
    historyLogs.unshift(item);
    renderHistoryTable();
  };

  const renderHistoryTable = () => {
    if (historyLogs.length === 0) {
      historyBody.innerHTML = `<tr class="empty-row"><td colspan="5">Chưa có mã OTP nào. Bấm <b>"⚡ LẤY MÃ OTP NGAY"</b> để bắt đầu.</td></tr>`;
      return;
    }

    historyBody.innerHTML = historyLogs.map(log => `
      <tr>
        <td><span class="history-code">${log.code}</span></td>
        <td>${log.time}</td>
        <td>${escapeHtml(log.from)}</td>
        <td>${escapeHtml(log.subject)}</td>
        <td>
          <button class="btn btn-secondary btn-copy-hist" data-code="${log.code}">📋 Copy</button>
        </td>
      </tr>
    `).join('');

    document.querySelectorAll('.btn-copy-hist').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const code = e.target.dataset.code;
        navigator.clipboard.writeText(code);
        showToast(`Đã copy mã: ${code}`);
      });
    });
  };

  btnClearLogs.addEventListener('click', () => {
    historyLogs = [];
    renderHistoryTable();
    showToast('Đã xóa lịch sử!');
  });

  function escapeHtml(str = '') {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
});
