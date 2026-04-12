const express = require("express");

function registerAuthRoutes(app) {
  app.post("/api/auth/register", (req, res) => {
    const { username, password } = req.body;
    res.json({ ok: true, message: "User registered", username });
  });

  app.post("/api/auth/login", (req, res) => {
    const { username } = req.body;
    res.json({ ok: true, message: "Login successful", username });
  });
}

module.exports = {
  registerAuthRoutes
};