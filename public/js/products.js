// public/js/products.js
document.addEventListener('DOMContentLoaded', () => {
    const addProductForm = document.getElementById('add-product-form');
    const productManagementList = document.getElementById('product-management-list');

    // Fetch and display products for management
    async function fetchProductsForManagement() {
        try {
            const response = await fetch('/api/products');
            const { data } = await response.json();
            productManagementList.innerHTML = ''; // Clear list
            data.forEach(product => {
                const itemEl = document.createElement('div');
                itemEl.className = 'product-mgmt-item';
                itemEl.innerHTML = `
                    <strong>${product.name}</strong>
                    <p>₱${product.price.toFixed(2)}</p>
                    <button class="delete-btn" data-id="${product.id}">Delete</button>
                `;
                productManagementList.appendChild(itemEl);
            });
        } catch (error) {
            console.error('Failed to fetch products:', error);
        }
    }

    // Handle form submission to add a new product
    addProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('product-name').value;
        const price = parseFloat(document.getElementById('product-price').value);
        const barcode = document.getElementById('product-barcode').value;

        try {
            const response = await fetch('/api/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, price, barcode }),
            });
            if (response.ok) {
                addProductForm.reset();
                fetchProductsForManagement(); // Refresh the list
            } else {
                alert('Failed to add product.');
            }
        } catch (error) {
            console.error('Error adding product:', error);
        }
    });

    // Handle delete button clicks
    productManagementList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('delete-btn')) {
            const productId = e.target.dataset.id;
            if (confirm('Are you sure you want to delete this product?')) {
                try {
                const response = await fetch(`/api/products/${productId}`, {
                        method: 'DELETE',
                    });
                    if (response.ok) {
                        fetchProductsForManagement(); // Refresh list
                    } else {
                        alert('Failed to delete product.');
                    }
                } catch (error) {
                    console.error('Error deleting product:', error);
                }
            }
        }
    });

    // Initial load
    fetchProductsForManagement();
});
