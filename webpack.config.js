module.exports = {
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        include: /src/,
        use: {
          loader: "babel-loader"
        }
      }
    ]
  },
  resolve: {
    extensions: [".js", ".jsx"]
  }
};
