if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
  const app = require("./api/index");
  const PORT = Number(process.env.PORT) || 4243;
  app.listen(PORT);
}
