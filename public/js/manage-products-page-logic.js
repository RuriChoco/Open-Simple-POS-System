document.addEventListener('DOMContentLoaded', () => {
    // --- Barcode Generation Logic ---

    // Generic function to render a barcode, now attached to window for global access.
    // This allows manage-products.js to call it.
    window.renderBarcode = (svgElement, containerElement, value, printButton) => {
        if (value) {
            try {
                JsBarcode(svgElement, value, {
                    format: "CODE128",
                    lineColor: "#000",
                    width: 2,
                    height: 50,
                    displayValue: true
                });
                containerElement.style.display = 'flex';
                if (printButton) printButton.style.display = 'block';
            } catch (e) {
                console.error("JsBarcode error:", e);
                containerElement.style.display = 'none';
                if (printButton) printButton.style.display = 'none';
            }
        } else {
            containerElement.style.display = 'none';
            if (printButton) printButton.style.display = 'none';
        }
    };

    // --- For "Add Product" Form ---
    const addBarcodeBtn = document.getElementById('generate-barcode-btn-add');
    const addBarcodeInput = document.getElementById('product-barcode');
    const addBarcodeSvg = document.getElementById('barcode-svg-add');
    const addBarcodeContainer = addBarcodeSvg.parentElement;
    const addPrintBtn = document.getElementById('print-barcode-btn-add');

    addBarcodeBtn.addEventListener('click', () => {
        const newBarcode = Date.now().toString();
        addBarcodeInput.value = newBarcode;
        window.renderBarcode(addBarcodeSvg, addBarcodeContainer, newBarcode, addPrintBtn);
    });

    addBarcodeInput.addEventListener('input', () => {
        window.renderBarcode(addBarcodeSvg, addBarcodeContainer, addBarcodeInput.value, addPrintBtn);
    });

    // After a product is added, clear the form for the next entry.
    // This listens for a custom event dispatched from manage-products.js on success.
    const addProductForm = document.getElementById('add-product-form');
    addProductForm.addEventListener('product-added-successfully', () => {
        addProductForm.reset();
        window.renderBarcode(addBarcodeSvg, addBarcodeContainer, '', addPrintBtn); // Hide barcode preview and print button
        document.getElementById('product-name').focus(); // Focus on the name field for the next entry
    });

    // --- For "Edit Product" Modal ---
    const editBarcodeBtn = document.getElementById('generate-barcode-btn-edit');
    const editBarcodeInput = document.getElementById('edit-product-barcode');
    const editBarcodeSvg = document.getElementById('barcode-svg-edit');
    const editBarcodeContainer = editBarcodeSvg.parentElement;
    const editPrintBtn = document.getElementById('print-barcode-btn-edit');

    editBarcodeBtn.addEventListener('click', () => {
        const newBarcode = Date.now().toString();
        editBarcodeInput.value = newBarcode;
        window.renderBarcode(editBarcodeSvg, editBarcodeContainer, newBarcode, editPrintBtn);
    });

    editBarcodeInput.addEventListener('input', () => {
        window.renderBarcode(editBarcodeSvg, editBarcodeContainer, editBarcodeInput.value, editPrintBtn);
    });

    // --- Printing Logic ---
    const printArea = document.getElementById('print-barcode-label-area');

    const handlePrint = (svgElement, name, price) => {
        if (!svgElement.hasChildNodes()) {
            alert('Please generate or enter a valid barcode first.');
            return;
        }

        const svgClone = svgElement.cloneNode(true);
        svgClone.setAttribute('width', '100%');

        // Construct the label content
        printArea.innerHTML = `
            <div class="barcode-label">
                <div class="label-product-name">${name || ''}</div>
                <div class="label-product-price">${price ? `₱${parseFloat(price).toFixed(2)}` : ''}</div>
                ${svgClone.outerHTML}
            </div>
        `;

        window.print();
    };

    addPrintBtn.addEventListener('click', () => {
        const name = document.getElementById('product-name').value;
        const price = document.getElementById('product-price').value;
        handlePrint(addBarcodeSvg, name, price);
    });

    editPrintBtn.addEventListener('click', () => {
        const name = document.getElementById('edit-product-name').value;
        const price = document.getElementById('edit-product-price').value;
        handlePrint(editBarcodeSvg, name, price);
    });

});

// This function is now defined globally in admin-helpers.js
// --- Utility function for displaying messages ---
function showMessage(msg, type = 'success', targetElementId = 'import-message-box') {
    const messageBox = document.getElementById(targetElementId);
    if (messageBox) {
        messageBox.innerText = msg; // Use innerText to render newlines correctly
        messageBox.className = `message ${type}`; // Assuming .message and .success/.error classes exist in CSS
        messageBox.style.display = 'block';
        setTimeout(() => { messageBox.style.display = 'none'; }, 15000); // Increased timeout for detailed messages
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // --- Bulk Import Logic ---
    const csvFileInput = document.getElementById('csv-file-input');
    const importCsvBtn = document.getElementById('import-csv-btn');
    const importMessageBox = document.getElementById('import-message-box');

    importCsvBtn.addEventListener('click', async () => {
        if (!csvFileInput.files || csvFileInput.files.length === 0) {
            showMessage('Please select a CSV file to import.', 'error', 'import-message-box');
            return;
        }

        const file = csvFileInput.files[0];
        const reader = new FileReader();

        reader.onload = async (e) => {
            const csvData = e.target.result;
            importCsvBtn.disabled = true;
            importCsvBtn.textContent = 'Importing...';
            showMessage('Importing products...', 'info', 'import-message-box');

            try {
                const response = await fetch('/api/products/import-csv', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ csvData }),
                });

                const result = await response.json();

                if (!response.ok) {
                    let errorMsg = result.error || 'Failed to import products.';
                    if (result.details && result.details.length > 0) {
                        errorMsg += '\n\nDetails:\n' + result.details.join('\n');
                    }
                    throw new Error(errorMsg);
                }

                let feedbackMsg = result.message;
                if (result.details && result.details.length > 0) {
                    feedbackMsg += `\n\nDetails on failed rows:\n` + result.details.join('\n');
                }
                showMessage(feedbackMsg, 'success', 'import-message-box');
                // Trigger product list refresh in manage-products.js
                document.dispatchEvent(new Event('products-imported'));
                csvFileInput.value = ''; // Clear the file input

            } catch (error) {
                console.error('Error during CSV import:', error);
                showMessage(`Error importing: ${error.message}`, 'error', 'import-message-box');
            } finally {
                importCsvBtn.disabled = false;
                importCsvBtn.textContent = 'Import CSV';
            }
        };

        reader.onerror = () => {
            showMessage('Error reading file.', 'error', 'import-message-box');
        };

        reader.readAsText(file);
    });
});

document.addEventListener('DOMContentLoaded', () => {
    // --- Export Products Logic ---
    const exportProductsCsvBtn = document.getElementById('export-products-csv-btn');

    exportProductsCsvBtn.addEventListener('click', async () => {
        exportProductsCsvBtn.disabled = true;
        exportProductsCsvBtn.textContent = 'Exporting...';
        showMessage('Exporting products...', 'info', 'import-message-box'); // Reusing import message box

        try {
            const response = await fetch('/api/products/export-csv'); // New endpoint
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to export products.');
            }
            const { data: products } = await response.json();

            if (products.length === 0) {
                showMessage('No products to export.', 'info', 'import-message-box');
                return;
            }

            const headers = ['id', 'name', 'price', 'barcode', 'quantity'];
            const csvRows = [headers.join(',')]; // CSV header row

            products.forEach(product => {
                const values = headers.map(header => `"${(product[header] !== null && product[header] !== undefined) ? String(product[header]).replace(/"/g, '""') : ''}"`);
                csvRows.push(values.join(','));
            });

            window.downloadCsv(csvRows.join('\n'), 'all-products.csv');
            showMessage('Products exported successfully!', 'success', 'import-message-box');
        } catch (error) {
            console.error('Error exporting products:', error);
            showMessage(`Error exporting: ${error.message}`, 'error', 'import-message-box');
        } finally {
            exportProductsCsvBtn.disabled = false;
            exportProductsCsvBtn.textContent = 'Export All Products to CSV';
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    // --- Database Management Logic ---
    const backupDbBtn = document.getElementById('backup-db-btn');
    const restoreDbBtn = document.getElementById('restore-db-btn');
    const restoreDbInput = document.getElementById('restore-db-input');

    // Backup
    backupDbBtn.addEventListener('click', () => {
        window.location.href = '/api/database/backup';
    });

    // Restore
    restoreDbBtn.addEventListener('click', async () => {
        if (!restoreDbInput.files || restoreDbInput.files.length === 0) {
            alert('Please select a database file (.db) to restore.');
            return;
        }

        if (!confirm('WARNING: Restoring the database will overwrite all current data. This action cannot be undone. Are you absolutely sure you want to proceed?')) {
            return;
        }

        const file = restoreDbInput.files[0];
        const formData = new FormData();
        formData.append('dbfile', file);

        restoreDbBtn.disabled = true;
        restoreDbBtn.textContent = 'Restoring...';

        try {
            const response = await fetch('/api/database/restore', {
                method: 'POST',
                body: formData, // No 'Content-Type' header needed, browser sets it for FormData
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to restore database.');
            }

            alert(result.message); // "Please restart the server..."
        } catch (error) {
            alert(`Error: ${error.message}`);
        } finally {
            restoreDbBtn.disabled = false;
            restoreDbBtn.textContent = 'Restore Database';
            restoreDbInput.value = ''; // Clear the file input
        }
    });
});