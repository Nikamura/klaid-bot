import winston from "winston";
import { config } from "./config";

export const logger = winston.createLogger({
  level: config.get("KLAID_LOG_LEVEL"),
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});
