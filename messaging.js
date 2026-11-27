import { apiFetch, listenForMessages } from './supabase-api.js';

class MessagingInterface {
  constructor(commissionId) {
    this.commissionId = commissionId;
    this.messages = [];
    this.currentUser = null;
    this.messageList = null;
    this.messageInput = null;
    this.sendButton = null;
    this.unsubscribe = null;
  }

  async init(container, onLoad = () => {}) {
    try {
      this.currentUser = JSON.parse(localStorage.getItem('vicom-session'));
      if (!this.currentUser) return;

      container.innerHTML = `
        <div class="messaging-container">
          <div class="message-list" id="message-list-${this.commissionId}"></div>
          <div class="message-input-container">
            <textarea class="message-input" placeholder="Type your message..." maxlength="500"></textarea>
            <button class="message-send">Send →</button>
          </div>
          <button class="report-message-button">⚠ Report this conversation</button>
        </div>
      `;

      this.messageList = container.querySelector(`#message-list-${this.commissionId}`);
      this.messageInput = container.querySelector('.message-input');
      this.sendButton = container.querySelector('.message-send');

      this.sendButton.addEventListener('click', () => this.sendMessage());
      this.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });

      container.querySelector('.report-message-button').addEventListener('click', () => this.showReportModal());

      await this.loadMessages();
      this.setupRealtime();
      onLoad(this.messages);
    } catch (error) {
      console.error('Failed to initialize messaging:', error);
    }
  }

  async loadMessages() {
    try {
      const res = await apiFetch(`../supabase-data?action=messages&commissionId=${encodeURIComponent(this.commissionId)}`);
      const data = await res.json();
      if (res.ok) {
        this.messages = data.messages || [];
        this.renderMessages();
        this.markMessagesRead();
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }

  setupRealtime() {
    this.unsubscribe = listenForMessages(
      this.commissionId,
      (messages) => {
        this.messages = messages;
        this.renderMessages();
        this.markMessagesRead();
      },
      (error) => console.error('Realtime error:', error)
    );
  }

  renderMessages() {
    if (!this.messageList) return;

    this.messageList.innerHTML = this.messages.map(msg => `
      <div class="message-bubble ${msg.senderId === this.currentUser?.userId ? 'own' : 'other'}">
        <div class="message-header">
          <strong>${msg.senderName}</strong>
          <small>${new Date(msg.createdAt).toLocaleString()}</small>
          ${msg.senderId !== this.currentUser?.userId ? `<button class="report-single-message" data-id="${msg.id}" title="Report this message">⚠</button>` : ''}
        </div>
        <div class="message-content">${msg.message.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
      </div>
    `).join('');

    this.messageList.scrollTop = this.messageList.scrollHeight;

    this.messageList.querySelectorAll('.report-single-message').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const messageId = e.target.dataset.id;
        const message = this.messages.find(m => m.id === messageId);
        if (message) this.showMessageReportModal(message);
      });
    });
  }

  async markMessagesRead() {
    try {
      await apiFetch('../supabase-data?action=mark_messages_read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commissionId: this.commissionId }),
      });
    } catch (error) {
      console.error('Failed to mark messages as read:', error);
    }
  }

  async sendMessage() {
    const message = this.messageInput.value.trim();
    if (!message || !this.currentUser) return;

    try {
      const res = await apiFetch('../supabase-data?action=send_message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commissionId: this.commissionId,
          senderId: this.currentUser.userId,
          message: message,
        }),
      });

      if (res.ok) {
        this.messageInput.value = '';
      } else {
        const data = await res.json();
        alert('Failed to send message: ' + data.error);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message');
    }
  }

  async submitReport({ reportedId, type, reason, commissionId = null, messageId = null }) {
    if (!this.currentUser?.userId) {
      alert('Please sign in to report.');
      return false;
    }
    if (!reportedId) {
      alert('Could not identify the user to report.');
      return false;
    }

    try {
      const res = await apiFetch('../supabase-data?action=create_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportedId,
          type,
          reason,
          commissionId,
          messageId,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not submit report.');
      }
      return true;
    } catch (error) {
      alert('Error: ' + (error.message || 'Could not submit report.'));
      return false;
    }
  }

  showReportModal() {
    const modal = document.createElement('div');
    modal.className = 'report-modal-overlay open';
    modal.innerHTML = `
      <div class="report-modal">
        <button class="report-modal-close" type="button">×</button>
        <h2>Report Conversation</h2>
        <p>Report inappropriate behavior in this conversation</p>
        <select class="report-reason-select">
          <option value="">Select reason...</option>
          <option value="Harassment">Harassment</option>
          <option value="Threats">Threats</option>
          <option value="Spam">Spam</option>
          <option value="Scam">Scam</option>
          <option value="Other">Other</option>
        </select>
        <textarea class="report-details-textarea" placeholder="Describe the issue..."></textarea>
        <div class="report-modal-actions">
          <button class="report-submit-btn" type="button">Submit Report</button>
          <button class="report-cancel-btn" type="button">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.report-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('.report-cancel-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    modal.querySelector('.report-submit-btn').addEventListener('click', async () => {
      const reason = modal.querySelector('.report-reason-select').value;
      const details = modal.querySelector('.report-details-textarea').value.trim();

      if (!reason) { alert('Please select a reason'); return; }
      if (!details) { alert('Please provide details'); return; }

      const otherParticipant = this.messages.find(m => m.senderId !== this.currentUser?.userId);
      if (!otherParticipant) { alert('Could not identify the other participant'); return; }

      const success = await this.submitReport({
        reportedId: otherParticipant.senderId,
        type: 'message',
        reason: `${reason}: ${details}`,
        commissionId: this.commissionId,
      });

      if (success) {
        modal.remove();
        alert('Report submitted successfully');
      }
    });
  }

  showMessageReportModal(message) {
    const modal = document.createElement('div');
    modal.className = 'report-modal-overlay open';
    modal.innerHTML = `
      <div class="report-modal">
        <button class="report-modal-close" type="button">×</button>
        <h2>Report Message</h2>
        <p>Report inappropriate content</p>
        <div class="reported-message-preview">
          <strong>From ${message.senderName}:</strong>
          <p>${message.message.replace(/</g, '&lt;').replace(/>/g, '&gt;').substring(0, 200)}</p>
        </div>
        <select class="report-reason-select">
          <option value="">Select reason...</option>
          <option value="Hate speech">Hate speech</option>
          <option value="Harassment">Harassment</option>
          <option value="Threats">Threats</option>
          <option value="Inappropriate content">Inappropriate content</option>
          <option value="Other">Other</option>
        </select>
        <textarea class="report-details-textarea" placeholder="Describe the issue..."></textarea>
        <div class="report-modal-actions">
          <button class="report-submit-btn" type="button">Submit Report</button>
          <button class="report-cancel-btn" type="button">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.report-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('.report-cancel-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    modal.querySelector('.report-submit-btn').addEventListener('click', async () => {
      const reason = modal.querySelector('.report-reason-select').value;
      const details = modal.querySelector('.report-details-textarea').value.trim();

      if (!reason) { alert('Please select a reason'); return; }
      if (!details) { alert('Please provide details'); return; }

      const success = await this.submitReport({
        reportedId: message.senderId,
        type: 'message',
        reason: `${reason}: ${details}`,
        commissionId: this.commissionId,
        messageId: message.id,
      });

      if (success) {
        modal.remove();
        alert('Report submitted successfully');
      }
    });
  }

  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}

export default MessagingInterface;