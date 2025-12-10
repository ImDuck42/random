// script.js
(function() {
    function getUrlParameter(name) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(name);
    }

    function createTextImage(text) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Customize canvas size and styles
        canvas.width = 600; // Width of text image
        canvas.height = 200; // Height of text image
        ctx.fillStyle = '#ffffff'; // Background color
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#000000'; // Text color
        ctx.font = '30px Arial'; // Font style
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2); // Center text

        // Convert canvas to base64
        return canvas.toDataURL('image/png');
    }

    const content = getUrlParameter('content');
    if (content) {
        const base64Image = createTextImage(content);
        document.getElementById('dynamicImage').setAttribute('content', base64Image);
    }
})();