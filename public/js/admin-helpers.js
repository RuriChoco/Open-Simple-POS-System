// public/js/admin-helpers.js
function formatPrice(number) {
    // Formats a number with commas for thousands and ensures two decimal places.
    return Number(number).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}