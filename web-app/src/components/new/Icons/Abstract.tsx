type Props = {
  variant?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  props?: React.SVGProps<SVGSVGElement>;
  fill?: string;
};

const Abstract = ({ fill = "white", variant = 1, props }: Props) => {
  switch (variant) {
    case 1:
      return (
        <svg
          className="icon"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill={fill}
          xmlns="http://www.w3.org/2000/svg"
          {...props}
        >
          <path
            fill="#F1F5F9"
            d="M20 10.2321V20.2279C17.3478 20.2279 14.8043 19.1748 12.929 17.3002C11.0536 15.4256 10 12.8831 10 10.2321H20Z"
          />
          <path
            fill="#F1F5F9"
            d="M15 0.227924C12.2386 0.227924 10 2.46557 10 5.22584C10 7.98612 12.2386 10.2238 15 10.2238C17.7614 10.2238 20 7.98612 20 5.22584C20 2.46557 17.7614 0.227924 15 0.227924Z"
          />
          <path
            fill="#F1F5F9"
            d="M0 20.2196C0 17.5685 1.05355 15.026 2.92892 13.1515C4.80429 11.2769 7.34783 10.2238 10 10.2238V20.2196H0Z"
          />
          <path fill="#F1F5F9" d="M10 0.219604H0V10.2154H10V0.219604Z" />
        </svg>
      );
    case 2:
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 5.22792C0 7.98935 2.23858 10.2279 5 10.2279C7.76142 10.2279 10 7.98935 10 5.22792C10 2.4665 7.76142 0.227866 5 0.227866C2.23858 0.227866 0 2.4665 0 5.22792Z"
            fill="#F1F5F9"
          />
          <path
            d="M20 5.22791C20 2.46648 17.7614 0.227905 15 0.227905C12.2386 0.227905 10 2.46648 10 5.22791C10 7.98933 12.2386 10.2279 15 10.2279C17.7614 10.2279 20 7.98933 20 5.22791Z"
            fill="#F1F5F9"
          />
          <path
            d="M0 15.2279C0 17.9893 2.23858 20.2279 5 20.2279C7.76142 20.2279 10 17.9893 10 15.2279C10 12.4665 7.76142 10.2279 5 10.2279C2.23858 10.2279 0 12.4665 0 15.2279Z"
            fill="#F1F5F9"
          />
          <path
            d="M10 15.2279C10 17.9893 12.2386 20.2279 15 20.2279C17.7614 20.2279 20 17.9893 20 15.2279C20 12.4665 17.7614 10.2279 15 10.2279C12.2386 10.2279 10 12.4665 10 15.2279Z"
            fill="#F1F5F9"
          />
        </svg>
      );
    case 3:
      return (
        <svg
          width="20"
          height="21"
          viewBox="0 0 20 21"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M10 5.2279C10 2.46648 7.76142 0.227905 5 0.227905C2.23858 0.227905 0 2.46648 0 5.2279C0 7.98933 2.23858 10.2279 5 10.2279C7.76142 10.2279 10 7.98933 10 5.2279Z"
            fill="#F1F5F9"
          />
          <path d="M20 0.227905H10V10.2279H20V0.227905Z" fill="#F1F5F9" />
          <path d="M0 10.2279L0 20.2279H10V10.2279H0Z" fill="#F1F5F9" />
          <path
            d="M10 15.2278C10 17.9893 12.2386 20.2279 15 20.2279C17.7614 20.2279 20 17.9893 20 15.2278C20 12.4664 17.7614 10.2279 15 10.2279C12.2386 10.2279 10 12.4664 10 15.2278Z"
            fill="#F1F5F9"
          />
        </svg>
      );
    case 4:
      return (
        <svg
          width="20"
          height="21"
          viewBox="0 0 20 21"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 10.4561C0 7.80389 1.05355 5.26036 2.92892 3.385C4.80429 1.50964 7.34783 0.456055 10 0.456055V10.4561H0Z"
            fill="#F1F5F9"
          />
          <path
            d="M20 0.456055V10.4561H10C10 7.80499 11.0534 5.26242 12.9285 3.38724C14.8037 1.51206 17.3472 0.457743 20 0.456055Z"
            fill="#F1F5F9"
          />
          <path
            d="M10 10.4561V20.4561H0C0 17.8039 1.05355 15.2604 2.92892 13.385C4.80429 11.5096 7.34783 10.4561 10 10.4561Z"
            fill="#F1F5F9"
          />
          <path
            d="M10 20.4561C10 17.8039 11.0535 15.2603 12.9289 13.385C14.8043 11.5096 17.3478 10.4561 20 10.4561V20.4561H10Z"
            fill="#F1F5F9"
          />
        </svg>
      );
    case 5:
      return (
        <svg
          width="20"
          height="21"
          viewBox="0 0 20 21"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M10 10.4602V20.456C7.34785 20.456 4.80433 19.4029 2.92897 17.5283C1.05362 15.6537 -1.02227e-08 13.1113 -1.02227e-08 10.4602H10Z"
            fill="#F1F5F9"
          />
          <path
            d="M5 0.464374C2.23857 0.464374 0 2.70202 0 5.46229C0 8.22257 2.23857 10.4602 5 10.4602C7.76143 10.4602 10 8.22257 10 5.46229C10 2.70202 7.76143 0.464374 5 0.464374Z"
            fill="#F1F5F9"
          />
          <path
            d="M15 20.4477C17.7614 20.4477 20 18.2101 20 15.4498C20 12.6896 17.7614 10.4519 15 10.4519C12.2386 10.4519 10 12.6896 10 15.4498C10 18.2101 12.2386 20.4477 15 20.4477Z"
            fill="#F1F5F9"
          />
          <path
            d="M20 10.4519H10V0.456055C12.6522 0.456055 15.1957 1.50918 17.0711 3.38376C18.9465 5.25835 20 7.80083 20 10.4519V10.4519Z"
            fill="#F1F5F9"
          />
        </svg>
      );
    case 6:
      return (
        <svg
          width="20"
          height="21"
          viewBox="0 0 20 21"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 10.6836C0 8.03143 1.05355 5.4879 2.92892 3.61254C4.80429 1.73718 7.34783 0.683594 10 0.683594V10.6836H0Z"
            fill="#F1F5F9"
          />
          <path
            d="M20 0.683594V10.6836H10C10 8.03253 11.0534 5.48996 12.9285 3.61478C14.8037 1.7396 17.3472 0.685282 20 0.683594Z"
            fill="#F1F5F9"
          />
          <path
            d="M10 10.6836V20.6836H0C0 18.0314 1.05355 15.4879 2.92892 13.6125C4.80429 11.7372 7.34783 10.6836 10 10.6836Z"
            fill="#F1F5F9"
          />
          <path
            d="M10 20.6836C10 18.0314 11.0535 15.4879 12.9289 13.6125C14.8043 11.7371 17.3478 10.6836 20 10.6836V20.6836H10Z"
            fill="#F1F5F9"
          />
        </svg>
      );
    case 7:
      return (
        <svg
          width="20"
          height="21"
          viewBox="0 0 20 21"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M10 10.6877V20.6836C7.34785 20.6836 4.80433 19.6304 2.92897 17.7559C1.05362 15.8813 0 13.3388 0 10.6877H10Z"
            fill="#F1F5F9"
          />
          <path
            d="M5 0.691913C2.23857 0.691913 0 2.92956 0 5.68983C0 8.45011 2.23857 10.6877 5 10.6877C7.76143 10.6877 10 8.45011 10 5.68983C10 2.92956 7.76143 0.691913 5 0.691913Z"
            fill="#F1F5F9"
          />
          <path
            d="M15 20.6753C17.7614 20.6753 20 18.4376 20 15.6774C20 12.9171 17.7614 10.6794 15 10.6794C12.2386 10.6794 10 12.9171 10 15.6774C10 18.4376 12.2386 20.6753 15 20.6753Z"
            fill="#F1F5F9"
          />
          <path
            d="M20 10.6794H10V0.683594C12.6522 0.683594 15.1957 1.73672 17.0711 3.6113C18.9465 5.48588 20 8.02836 20 10.6794Z"
            fill="#F1F5F9"
          />
        </svg>
      );
    default:
      return <></>;
  }
};

export default Abstract;
