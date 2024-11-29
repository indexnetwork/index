let modelInfo = null

export async function getModelInfo() {
  if (modelInfo) {
    return modelInfo
  }

  try {
    const modelResponse = await fetch(`http://localhost:8000/model/info`);
    const modelInfo = await modelResponse.json();
    return modelInfo;
  } catch (error) {
    console.error('Error fetching model info:', error);
    return null;
  }
}