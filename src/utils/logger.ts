import winston from "winston";
import { config } from "./config.js";

export const logger = winston.createLogger({
  level: config.KLAID_LOG_LEVEL,
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});
