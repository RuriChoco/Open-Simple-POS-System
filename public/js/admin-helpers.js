// public/js/admin-helpers.js
function formatPrice(number) {
    // Formats a number with commas for thousands and ensures two decimal places.
    return Number(number).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

// Global utility function for downloading CSVs
window.downloadCsv = function(csvString, fileName) {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

document.addEventListener('DOMContentLoaded', () => {
    // --- Self-contained, Global Confirmation Modal Logic ---

    // Create modal HTML if it doesn't exist on the page. This makes the helper self-sufficient.
    if (!document.getElementById('confirmation-modal')) {
        const modalHTML = `
            <div id="confirmation-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content" style="max-width: 400px;">
                    <button class="modal-close-btn">&times;</button>
                    <h2 id="confirmation-title">Confirm Action</h2>
                    <p id="confirmation-message" style="margin: 1.5rem 0;"></p>
                    <div class="action-buttons">
                        <button id="cancel-confirmation-btn" class="btn btn-secondary">Cancel</button>
                        <button id="confirm-action-btn" class="btn btn-danger">Confirm</button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    const confirmationModal = document.getElementById('confirmation-modal');
    const confirmationTitle = document.getElementById('confirmation-title');
    const confirmationMessage = document.getElementById('confirmation-message');
    const confirmActionBtn = document.getElementById('confirm-action-btn');
    const cancelConfirmationBtn = document.getElementById('cancel-confirmation-btn');
    const closeConfirmationBtn = confirmationModal.querySelector('.modal-close-btn');
    let onConfirmCallback = null;
    let onCancelCallback = null;

    window.showConfirmationModal = ({ title, message, confirmText, onConfirm, onCancel }) => {
        confirmationTitle.textContent = title || 'Confirm Action';
        confirmationMessage.innerHTML = message;
        confirmActionBtn.textContent = confirmText || 'Confirm';
        onConfirmCallback = onConfirm;
        onCancelCallback = onCancel;
        confirmationModal.style.display = 'flex';
    };

    const hideConfirmationModal = (isCancel = false) => {
        if (isCancel && typeof onCancelCallback === 'function') onCancelCallback();
        confirmationModal.style.display = 'none';
        onConfirmCallback = null;
        onCancelCallback = null;
    };

    confirmActionBtn.addEventListener('click', () => {
        if (typeof onConfirmCallback === 'function') onConfirmCallback();
        hideConfirmationModal(false);
    });

    cancelConfirmationBtn.addEventListener('click', () => hideConfirmationModal(true));
    closeConfirmationBtn.addEventListener('click', () => hideConfirmationModal(true));
    confirmationModal.addEventListener('click', (e) => {
        if (e.target === confirmationModal) hideConfirmationModal(true);
    });
});