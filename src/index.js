/**
 * GitLab Milestones reporting and Excel export backend
 * 
 * @abstract Core entry point and request orchestrator
 * @copyright 2024 MRB, Forvest Backend Team
 * @author GitLab Report Team
 * @virtual Service initialization and HTTP request handling
 * 
 * @module gitlab_report
 * 
 * @description
 * Fetches GitLab milestone data, generates reports, exports to Excel format
 * 
 * Initialization steps:
 * - Load environment configuration and validate required variables
 * - Connect to MongoDB database for data persistence
 * - Initialize middleware stack (CORS, compression, validation, authentication)
 * - Setup routing and API endpoint handlers
 * - Configure error handling and logging
 * - Start HTTP server on configured port
 * 
 * Main API endpoints:
 * - GET/POST/PUT/DELETE endpoints for resource management
 * - Multipart/form-data support for file uploads
 * - Authentication/authorization middleware for protected routes
 * - Swagger documentation at /api-docs
 * 
 * External integrations:
 * - MongoDB for data storage
 * - RabbitMQ for async messaging (if applicable)
 * - Payment processors (Zarinpal, Stripe, etc. if applicable)
 * - MinIO/S3 for object storage (if applicable)
 * - Third-party APIs (GitLab, Telegram, etc. if applicable)
 * 
 * Graceful shutdown implemented for:
 * - SIGTERM, SIGINT process signals
 * - Uncaught exceptions and unhandled promise rejections
 */

// *** MRB *** //
// #### --> MRB <-- ### //
'use strict';

import 'dotenv/config';

import './init.js';

import './server.js';
// #### --> MRB <-- ### //
// >>> MRB <<< //
