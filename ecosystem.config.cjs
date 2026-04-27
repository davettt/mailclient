module.exports = {
  apps: [
    {
      name: 'mailclient',
      script: 'dist/server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        PORT: 3200,
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
