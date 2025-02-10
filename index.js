require("dotenv").config();
const express = require("express");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const { callApi } = require('./api.js');

const gameName = "jumpingjuniper";
const webURL = "www.jumpingjuniper.floramis.com";

const server = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const port = process.env.PORT || 6100;

const SCORE_TOKEN = process.env.SCORE_TOKEN.split(";").map((t) => BigInt(t));

const queries = {};

function addAllNumbers(number) {
  const strNumber = number.toString();

  if (strNumber.length === 1) return number;

  const numbers = strNumber.split("");
  var sum = 0;
  for (var i = 0; i < numbers.length; i++) {
    sum += parseInt(numbers[i], 10);
  }
  return addAllNumbers(sum);
}

async function logEvent(userid, eventType, sessionId, customData) {
    try {
        const resp = await callApi("EventTracker", {
            data: {
                userID: "TELEGRAM_USER_#" + userid,
                eventType: eventType,
                sceneName: "JumpingJuniper_" + sessionId,
                customData: customData
            },
            clientVer: "0.4.6"
        });

        console.log(`Tracked ${eventType} for user ${userid}`);
    } catch (error) {
        console.error("Event Tracker API call failed:", error);
    }
}

bot.onText(/\/help/, (msg) =>
  bot.sendMessage(
    msg.from.id,
    "This bot implements a simple game called Jumping Juniper. Say /game if you want to play."
  )
);
bot.onText(/\/start|\/game/, (msg) => bot.sendGame(msg.from.id, gameName));
bot.on("callback_query", function (query) {
  if (query.game_short_name !== gameName) {
    bot.answerCallbackQuery(
      query.id,
      "Sorry, '" + query.game_short_name + "' is not available."
    );
  } else {
    queries[query.id] = query;

    // Get player details
    const playerId = query.from.id;
    const playerName = `${query.from.first_name || ""} ${query.from.last_name || ""}`.trim();
    const language = query.from.language_code || "Unknown"

    // Determine whether the game was sent as an inline message or in a chat and get game score params based off that
    const isInlineMessage = !!query.inline_message_id;
    const gameScoreParams = isInlineMessage
      ? { inline_message_id: query.inline_message_id }
      : query.message?.chat?.id && query.message?.message_id
        ? { chat_id: query.message.chat.id, message_id: query.message.message_id }
        : null;
    
    // Failed to determine correct parameters for getGameHighScores - just return highscore as 0 
    if (!gameScoreParams) {
      console.log("Failed to get highscore for player " + playerId);
      const gameUrl = `https://${webURL}/index.html?id=${query.id}&highscore=0`;
      bot.answerCallbackQuery(query.id, { url: gameUrl });
      return;
    }

    // Fetches score of the specified user and several of their neighbors in a game
    bot.getGameHighScores(playerId, gameScoreParams)
      .then(scores => {
        // Filter to only retrieve the user's score (if any)
        const userScore = scores.find(s => s.user.id === playerId)?.score || 0;

        console.log(`Got player ${playerId}'s highscore from ${isInlineMessage ? "inline message" : "chat message"} case, highscore: ${userScore}`)

        // Track session start event in our EventTracking database along with relevant information about the user
        const sessionId = isInlineMessage ? "InlineMsg_#" + query.inline_message_id : "ChatMsg_#" + query.message.chat.id
        logEvent(playerId, "SessionStart", sessionId, `Name: ${playerName}, Language: ${language}, Current Highscore: ${userScore}`)

        // User's score has to be multipled by 100 as scores are divided by 100 when stored in telegram leaderboard 
        // to get real score with decimal points, whereas scores are sent as long integers (See IObfuscation class in unity project)
        const gameUrl = `https://${webURL}/index.html?id=${query.id}&highscore=${userScore * 100}`; 
        bot.answerCallbackQuery(query.id, { url: gameUrl });
      })
      .catch(err => {
        console.error("Failed to get high score:", err);
        const gameUrl = `https://${webURL}/index.html?id=${query.id}&highscore=0`;
        bot.answerCallbackQuery(query.id, { url: gameUrl });
      });
  }
});

bot.on("inline_query", function (iq) {
  bot.answerInlineQuery(iq.id, [
    { type: "game", id: "0", game_short_name: gameName },
  ]);
});

server.use(express.static(path.join(__dirname, "public")));

server.get("/score/:score", function (req, res, next) {
  if (!Object.hasOwnProperty.call(queries, req.query.id)) return next();

  // Read isHighScore from query params
  const isHighScore = req.query.isHighScore === "true"; 

  let query = queries[req.query.id];
  const isInlineMessage = !!query.inline_message_id;
  // Get player details
  const playerId = query.from.id;
  const playerName = `${query.from.first_name || ""} ${query.from.last_name || ""}`.trim();
  const language = query.from.language_code || "Unknown"
  const sessionId = isInlineMessage ? "InlineMsg_#" + query.inline_message_id : "ChatMsg_#" + query.message.chat.id

  // ===== Obfuscation decoding starts =====
  // Change this part if you want to use your own obfuscation method
  const obfuscatedScore = BigInt(req.params.score);
  const token = SCORE_TOKEN[addAllNumbers(BigInt(req.query.id)) - 1];
  const receivedScore = Math.round(Number(obfuscatedScore / token));

  // If the score is valid
  if (BigInt(receivedScore) * token == obfuscatedScore) {
    // ===== Obfuscation decoding ends =====
    const realScore = receivedScore / 100.0;    // Get real score of player with decimal points

    if (!isHighScore) {
      // Logs player's activity
      console.log("player : " + query.from.id + " achieved a score of: " + realScore);
      logEvent(playerId, "GameEnd", sessionId, `Name: ${playerName}, Language: ${language}, Game's score: ${realScore}`)
      
      return res.status(200).send("Score logged successfully");
    }

    // Logs player's activity
    console.log("player : " + query.from.id + " achieved new highscore: " + realScore);
    logEvent(playerId, "GameEnd", sessionId, `Name: ${playerName}, Language: ${language}, New Highscore: ${realScore}`)

    const gameScoreParams = isInlineMessage
      ? { inline_message_id: query.inline_message_id }
      : { chat_id: query.message.chat.id, message_id: query.message.message_id }

    // If player achieved a new highscore, update it in their group chat
    bot
      .setGameScore(query.from.id, realScore, gameScoreParams)
      .then((b) => {
        return res.status(200).send("Score added successfully");
      })
      .catch((err) => {
        if (
          err.response.body.description ===
          "Bad Request: BOT_SCORE_NOT_MODIFIED"
        ) {
          return res
            .status(204)
            .send("New score is inferior to user's previous one");
        } else {
          return res.status(500);
        }
      });
    return;
  } else {
    return res.status(400).send("Are you cheating ?");
  }
});

server.listen(port);
