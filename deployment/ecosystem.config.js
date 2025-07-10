// PM2 Ecosystem Configuration for NTC Backend
// This file defines the PM2 process configuration for the Nyota Translation Center backend
// Place this file as ecosystem.config.js in /var/www/ntc-backend/

module.exports = {
  apps: [{
    // Application name in PM2 process list
    name: 'ntc-backend',
    
    // Path to the compiled JavaScript entry point
    script: './dist/index.js',
    
    // Working directory (should be the backend root)
    cwd: '/var/www/ntc-backend',
    
    // Node.js execution mode
    exec_mode: 'fork',
    
    // Number of instances (1 for single instance, 'max' for cluster mode)
    instances: 1,
    
    // Auto-restart on crash
    autorestart: true,
    
    // Watch for file changes and restart (set to false in production)
    watch: false,
    
    // Maximum memory threshold for restart
    max_memory_restart: '1G',
    
    // Environment variables for production
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    
    // Development environment variables (if needed)
    env_development: {
      NODE_ENV: 'development',
      PORT: 5000
    },
    
    // Logging configuration
    log_file: '/var/log/pm2/ntc-backend.log',
    out_file: '/var/log/pm2/ntc-backend-out.log',
    error_file: '/var/log/pm2/ntc-backend-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Merge logs from different instances
    merge_logs: true,
    
    // Time before force killing the process during restart
    kill_timeout: 3000,
    
    // Time to wait before considering the app as online
    listen_timeout: 10000,
    
    // Minimum uptime before considering the app as stable
    min_uptime: '10s',
    
    // Max restarts within a time window
    max_restarts: 10,
    
    // Time window for max_restarts
    restart_delay: 4000
  }]
};
