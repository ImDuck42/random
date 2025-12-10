<?php
// 1. GET THE CONTENT PARAMETER FROM URL
// If ?content=Hello is set, use it. Otherwise use "Default Text".
$text = isset($_GET['content']) ? $_GET['content'] : 'Default Text';

// 2. GENERATE THE IMAGE URL
// We use a free, fast API (placehold.co) to generate the image on the fly.
// We urlencode the text so spaces and symbols don't break the link.
$imageUrl = "https://placehold.co/600x300/white/black/png?text=" . urlencode($text);

// 3. GET CURRENT PAGE URL (For the Discord embed link)
$protocol = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http";
$currentUrl = $protocol . "://$_SERVER[HTTP_HOST]$_SERVER[REQUEST_URI]";
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Dynamic Embed: <?php echo htmlspecialchars($text); ?></title>

    <!-- DISCORD / SOCIAL MEDIA TAGS -->
    <!-- This runs on the server, so Discord sees the value immediately. -->
    <meta property="og:title" content="Message for you">
    <meta property="og:description" content="Click to view the dynamic content">
    <meta property="og:image" content="<?php echo $imageUrl; ?>">
    <meta property="og:url" content="<?php echo $currentUrl; ?>">
    <meta name="theme-color" content="#ffffff">
    <meta name="twitter:card" content="summary_large_image">

    <!-- CSS (Vanilla) -->
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background-color: #f0f0f0;
        }
        img {
            max-width: 100%;
            border: 2px solid #333;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .info {
            margin-top: 20px;
            color: #555;
        }
    </style>
</head>
<body>

    <!-- Display the Image in the Browser too -->
    <h1>Dynamic Text Image Embed</h1>
    <img src="<?php echo $imageUrl; ?>" alt="Dynamic Generated Image">
    
    <div class="info">
        <p>Copy this URL to Discord:</p>
        <code><?php echo $currentUrl; ?></code>
    </div>

</body>
</html>
