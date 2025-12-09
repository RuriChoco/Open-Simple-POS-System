// --- Theme Application Logic ---
(function() {
    const themeManager = {
        apply(theme) {
            // Add a class to the body to enable CSS scoping for the theme
            document.body.classList.remove('dark-theme');
            if (theme === 'dark') {
                document.body.classList.add('dark-theme');
            }
        },
        async load() {
            try {
                const response = await fetch('/api/settings');
                if (!response.ok) throw new Error('Failed to fetch settings');
                const { data } = await response.json();
                if (data.pos_theme) {
                    this.apply(data.pos_theme);
                }
            } catch (error) {
                console.error('Error loading theme:', error);
            }
        }
    };

    // Load theme on initial page load
    document.addEventListener('DOMContentLoaded', () => themeManager.load());

    // To make the theme change in real-time, you should integrate themeManager.load()
    // into your WebSocket 'onmessage' handler in /js/main.js when a 'SETTINGS_UPDATED' message is received.
})();