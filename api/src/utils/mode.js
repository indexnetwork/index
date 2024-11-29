let modelInfo = null

export async function getModelInfo() {
  if (modelInfo) {
    return modelInfo
  }

  try {
    const port = process.env.PORT || 8000;
    const modelResponse = await fetch(`http://localhost:${port}/model/info`);
    const modelInfo = await modelResponse.json();
    return modelInfo;
  } catch (error) {
    console.error('Error fetching model info:', error);
    return null;
  }
}