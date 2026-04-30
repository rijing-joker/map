import "dotenv/config";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 5174);
const { app } = createApp();

app.listen(port, "127.0.0.1", () => {
  console.log(`Route planner API listening on http://127.0.0.1:${port}`);
});
