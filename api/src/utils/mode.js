let modelInfo = null

export async function getModelInfo() {
  if (modelInfo) {
    return modelInfo
  }

  try {
    const modelResponse = await fetch(`${process.env.API_HOST}/model/info`);
    const modelInfo = await modelResponse.json();
    return modelInfo;
  } catch (error) {
    console.error('Error fetching model info:', error);
    return null;
  }
}