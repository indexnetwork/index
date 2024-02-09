import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';


async function bootstrap() {

  Logger.log(`Starting server on port ${process.env.PORT}`, 'Bootstrap');


  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;


  // const corsOptions: CorsOptions = {
  //   origin: `http://localhost:${port}`, // Specify the front-end URL
  //   credentials: true, // Enable reading cookies from the request
  //   methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  //   maxAge: 24 * 60 * 60 * 5, // Set the maximum age of preflight requests to 5 days
  // };

  // // Enable CORS with the specified options.
  // app.enableCors(corsOptions);
  // Use global validation pipes for input validation.
  app.useGlobalPipes(new ValidationPipe());

  const config = new DocumentBuilder()
    .setTitle('Indexer API')
    .setDescription('The Chat Agent API for Index Network')
    .setVersion('0.1')
    .addTag('indexer')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Use the cookie-parser middleware to parse cookies from incoming requests.
  app.use(cookieParser());

  await app.listen(port, () =>
    console.log(`📢 Server starting on: http://localhost:${port}/ ⚡️`),
  );

}
bootstrap();
