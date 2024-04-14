const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    libraryTarget: 'umd',
    globalObject: 'this',
    publicPath: 'dist/',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  module: {
    rules: [
      {
        test: /\.(png|svg|jpg|jpeg|gif)$/,
        type: 'asset',
        generator: {
          filename: 'assets/image/[name][ext]',
        },
        parser: {
          dataUrlCondition: {
            maxSize: 100 * 1024 // max 100kb
          }
        }
      },
      {
        test: /\.(woff(2)?|ttf|eot|otf)$/,
        type: 'asset/resource',
        generator: {
          filename: 'assets/font/[name][ext]'
        }
      },
      {
        test: /\.(ts|tsx)$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.(js|jsx)$/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react']
          }
        },
        exclude: /node_modules/
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader', 'postcss-loader'],
      },
    ]
  },
  externals: {
    'react': 'commonjs react',
    'react-dom': 'commonjs react-dom'
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: './src/assets/style', to: 'assets/style' },
      ],
    }),
  ],
};
