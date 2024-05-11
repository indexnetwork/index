import winston from 'winston';

const { combine, timestamp, splat, printf, colorize } = winston.format;

const customFormat = printf(({ level, message, timestamp, stack }) => {
  const logMessage = stack || message;
  return `[Index Network Consumer API] [${timestamp}] [${level}]: ${logMessage}`;
});

const formatLevel = (info => {
    info.level = info.level.toUpperCase()
    return info;
});

class Logger {
  static instance;

  constructor() {
      // Create a logger instance
      Logger.instance = winston.createLogger({
        level: 'info', // Minimum log level to log
        format: combine(
          colorize({ all: true }), // Add colors to the output, useful for console transport
          splat(), // Interpolate variables in the log message
          timestamp( { format: "DD.MM.YYYY - HH:MM:SS" } ), // Add timestamp to the output
          customFormat // Use the custom format
        ),
        transports: [
          new winston.transports.Console(),
          // Add other transports here, e.g., file transport for persistent logging
          // new winston.transports.File({ filename: 'combined.log' })
        ],
      });

      if (process.env.NODE_ENV !== 'production') {
        // Logger.instance.add(new winston.transports.Console({
        //   format: winston.format.simple(),
        // }));
      }
  }

  static getInstance() {
    if (!Logger.instance) {
      new Logger();
    }
    return Logger.instance;
  }
}

export default Logger;
