import Image from "next/image";
import React, { useState } from "react";

const testimonials = [
  {
    name: "Joseph Lubin",
    title: "Consensys, Founder & CEO",
    image: "/images/testimonials/lubin.jpg",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Neque vitae tempus quam pellentesque nec nam aliquam. Enim diam vulputate ut pharetra sit amet aliquam. Etiam erat velit scelerisque in dictum non consectetur a.",
    twitter: "https://twitter.com/ethereumJoseph",
  },
  {
    name: "Danny Zuckerman",
    title: "3Box Labs, Co-founder",
    image: "/images/testimonials/zuckerman.jpg",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Neque vitae tempus quam pellentesque nec nam aliquam. Enim diam vulputate ut pharetra sit amet aliquam. Etiam erat velit scelerisque in dictum non consectetur a.",
    twitter: "https://twitter.com/dazuck",
  },
  {
    name: "Adam Corrado",
    title: "3Box Labs, Partnerships and BD Lead",
    image: "/images/testimonials/corrado.jpg",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Neque vitae tempus quam pellentesque nec nam aliquam. Enim diam vulputate ut pharetra sit amet aliquam. Etiam erat velit scelerisque in dictum non consectetur a.",
    twitter: "https://twitter.com/dazuck",
  },
  {
    name: "Joseph Lubin",
    title: "Consensys, Founder & CEO",
    image: "/images/testimonials/lubin.jpg",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Neque vitae tempus quam pellentesque nec nam aliquam. Enim diam vulputate ut pharetra sit amet aliquam. Etiam erat velit scelerisque in dictum non consectetur a.",
    twitter: "https://twitter.com/ethereumJoseph",
  },
  {
    name: "Danny Zuckerman",
    title: "3Box Labs, Co-founder",
    image: "/images/testimonials/zuckerman.jpg",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Neque vitae tempus quam pellentesque nec nam aliquam. Enim diam vulputate ut pharetra sit amet aliquam. Etiam erat velit scelerisque in dictum non consectetur a.",
    twitter: "https://twitter.com/dazuck",
  },
  {
    name: "Adam Corrado",
    title: "3Box Labs, Partnerships and BD Lead",
    image: "/images/testimonials/corrado.jpg",
    text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Neque vitae tempus quam pellentesque nec nam aliquam. Enim diam vulputate ut pharetra sit amet aliquam. Etiam erat velit scelerisque in dictum non consectetur a.",
    twitter: "https://twitter.com/dazuck",
  },
];

const TestimonialSlider = () => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const goToNextSlide = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % testimonials.length);
  };

  const goToPrevSlide = () => {
    setCurrentIndex(
      (prevIndex) =>
        (prevIndex - 1 + testimonials.length) % testimonials.length,
    );
  };

  return (
    <div className="mx-auto py-10 relative">
      <div className="overflow-hidden">
        <div
          className="flex gap-10 md:pr-12 no-scrollbar overflow-x-auto snap-x snap-mandatory scroll-smooth transition-transform duration-500"
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {testimonials.map((testimonial, index) => (
            <div
              key={index}
              className="snap-center w-[400px] relative flex-shrink-0 bg-gray-800 text-white p-8 rounded-lg shadow-lg"
            >
              <a href={testimonial.twitter} target="_blank" rel="noreferrer">
                <Image
                  src={"/images/ic_twitter.svg"}
                  width={16}
                  height={16}
                  alt="twitter"
                  className="absolute right-8 top-8"
                />
              </a>
              <div className="flex items-center mb-4">
                <Image
                  width={48}
                  height={48}
                  src={testimonial.image}
                  alt={testimonial.name}
                  className="w-12 h-12 rounded-full mr-4"
                />
                <div>
                  <h3 className="text-xl font-bold">{testimonial.name}</h3>
                  <p className="text-sm">{testimonial.title}</p>
                </div>
              </div>
              <p className="text-sm">{testimonial.text}</p>
            </div>
          ))}
        </div>
      </div>
      {/* <button
        onClick={goToPrevSlide}
        className="absolute top-1/2 left-0 transform -translate-y-1/2 bg-gray-800 text-white p-2 rounded-full"
      >
        Prev
      </button>
      <button
        onClick={goToNextSlide}
        className="absolute top-1/2 right-0 transform -translate-y-1/2 bg-gray-800 text-white p-2 rounded-full"
      >
        Next
      </button> */}
    </div>
  );
};

export default TestimonialSlider;
