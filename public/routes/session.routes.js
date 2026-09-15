const express = require("express");
const router = express.Router();
const { createSession } = require("../services/session.service");

router.get("/new", createSession);

module.exports = router;