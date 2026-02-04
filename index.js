const express = require("express");
const app = express();

// Render gives you the PORT automatically
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Render server is alive 🚀");
});

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
