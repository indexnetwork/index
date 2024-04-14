<h1 align="center">
    <a href="https://index.network/#gh-light-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo.png">
    </a>
    <a href="https://index.network/#gh-dark-mode-only">
    <img style="width:400px" src="https://index.network/images/IndexNetworkLogo-white.png">
    </a>
</h1>
<p align="center">
  <i align="center">Create and monetize interoperable discovery engines. 🚀</i>
</p>

<div align="center">

![CI](https://github.com/confxsd/index-chat/actions/workflows/ci.yml/badge.svg)
[![npm version](https://img.shields.io/npm/v/index-chat.svg)](https://www.npmjs.com/package/index-chat)

![React](https://img.shields.io/badge/react-18.2-blue.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.3-blue.svg)
![Babel](https://img.shields.io/badge/babel-7.23-blue.svg)
![Webpack](https://img.shields.io/badge/webpack-5.89-blue.svg)
![TailwindCSS](https://img.shields.io/badge/tailwindcss-3.4-blue.svg)

</div>

# IndexChat

IndexChat is a chat UI component specifically designed for interaction within the Index Network. 

Super easy to integrate and offers a seamless experience, making it an ideal tool for:

- creators, 
- communities, 
- DAOs, 
- brands,
- researchers, and many more


👉🏻 [View Demo](https://index-demo-delta.vercel.app)


Let's start building! ⛓️


<div>
<img alt="Demo Screen" style="width:500px" src="demo/ui-light.png#gh-light-mode-only" />
<img alt="Demo Screen" style="width:500px" src="demo/ui-dark.png#gh-dark-mode-only" />
</div>


## Features

- Easy to integrate with any React application
- Real-time chat capabilities powered by modern practices
- Responsive design and built-in dark mode
- Fully customizable themes


## Installation

Get the latest package via npm.

```bash
npm install index-chat
```

## Usage

Place `IndexChat` tag into your app with your `index_id`. 

This code creates a button that handles all the configuration. Now you can click it to start chatting. No extra work is required. 🎉


```typescript
import IndexChat from 'index-chat';

const App = () => {
  return (
    <div>
      {/* Your components */}
      <IndexChat id='index_id'  />
    </div>
  );
};

export default App;
```


## Styling

IndexChat allows you to customize the theme by overriding the defaults for any provided value. Here's an example of how you can set a custom theme:


```typescript
const customStyle = {
  darkMode: true,
  theme: {
    light: {
      primary: '#0F172A',
      secondary: '#475569',
      accent: '#BED0EC',
      background: '#FFFFFF',
      border: '#E2E8F0',
      pale: '#F8FAFC',
    },
    dark: {
      primary: '#DFEAF4',
      secondary: '#E7EEFF',
      accent: '#1256A2',
      background: '#0F172A',
      border: '#314969',
      pale: '#212C45',
    },
  }
};

const App = () => {
  return (
    <div>
      {/* Your components */}
      <IndexChat id='index_id' style={customStyle} />
    </div>
  );
};
```

### Fonts

The package uses `Inter` as the primary and `Freizeit` as the secondary font default. If you want to enable them, add the following line to your app.

```typescript
import 'index-chat/dist/assets/style/fonts.css';
```


## Warnings and Compatibility

Before integrating `index-chat` into your project, please consider the following:


### Requirements

- <b>React Version:</b> `index-chat` uses version 18.2.0. Ensure that your project has a compatible version.

- The jsx option is set to `react-jsx`, which requires React 17+.

- <b>TypeScript Version:</b> The package is built with TypeScript 5.3.3. Projects using an older version might encounter compatibility issues.

- `index-chat` is compiled as a UMD (Universal Module Definition) module. Ensure that your module bundler and environment are compatible with UMD modules.


## Contributing

Contributions are always welcome! Please read the contributing guidelines to get started.

## License

This project is licensed under the MIT License.