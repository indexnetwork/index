import axios from "axios";
import { EXTERNAL_API_ENDPOINTS } from "utils/constants";

class ExternalApiService {
  public axios = axios.create();
  async subscribeToNewsletter(email: string) {
    try {
      const formData = new FormData();
      formData.append("email", email);

      const response = await this.axios.post(
        EXTERNAL_API_ENDPOINTS.MAILCHIMP_SUBSCRIBE,
        formData,
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
            },
        },
      );

      if (typeof response.data === "string") {
        return JSON.parse(response.data);
      }

      return response.data;
    } catch (error) {
       // TODO: Handle error
    }
  }
}

const externalApi = new ExternalApiService();
export default externalApi;
