
Create Index
http://localhost:35000/graphql?operationName=newIndex&query=mutation%20newIndex(%24i%3A%20CreateIndexInput!)%20%7B%0A%20%20createIndex(input%3A%20%24i)%20%7B%0A%20%20%20%20document%20%7B%0A%20%20%20%20%20%20id%0A%20%20%20%20%20%20title%0A%20%20%20%20%20%20userID%0A%20%20%20%20%20%20createdAt%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D%0A&variables=%7B%0A%20%20%22i%22%3A%20%7B%0A%20%20%20%20%22content%22%3A%20%7B%0A%20%20%20%20%20%20%22title%22%3A%20%22Merhaba%22%2C%0A%20%20%20%20%20%20%22userID%22%3A%20%221%22%2C%0A%20%20%20%20%20%20%22createdAt%22%3A%20%22a%22%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D


Create Link
http://localhost:35000/graphql?operationName=newLink&query=mutation%20newLink(%24i%3A%20CreateLinkInput!)%20%7B%0A%20%20createLink(input%3A%20%24i)%20%7B%0A%20%20%20%20document%20%7B%0A%20%20%20%20%20%20indexID%0A%20%20%20%20%20%20users%0A%20%20%20%20%20%20url%0A%20%20%20%20%20%20title%0A%20%20%20%20%20%20tags%0A%20%20%20%20%20%20createdAt%0A%20%20%20%20%20%20updatedAt%0A%20%20%20%20%20%20content%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D%0A&variables=%7B%0A%20%20%22i%22%3A%20%7B%0A%20%20%20%20%22content%22%3A%20%7B%0A%20%20%20%20%20%20%22indexID%22%3A%20%22kjzl6kcym7w8y9xtuunvelrmmbyq137diuhdcstoc7mnuwqf0cdl6an9emptfvr%22%2C%0A%20%20%20%20%20%20%22users%22%3A%20%22users%22%2C%0A%20%20%20%20%20%20%22url%22%3A%20%22url%22%2C%0A%20%20%20%20%20%20%22title%22%3A%20%22title%22%2C%0A%20%20%20%20%20%20%22tags%22%3A%20%22tags%22%2C%0A%20%20%20%20%20%20%22createdAt%22%3A%20%22createdAt%22%2C%0A%20%20%20%20%20%20%22updatedAt%22%3A%20%22updatedAt%22%2C%0A%20%20%20%20%20%20%22content%22%3A%20%22content%22%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D

Get Index with Links
http://localhost:35000/graphql?operationName=newLink&query=%7B%0A%20%20node(id%3A%20%22kjzl6kcym7w8y8lh6f92js84kkrheuytvnvtbfgqqky4f59x51oesg8lo79akyd%22)%20%7B%0A%20%20%20%20id%0A%20%20%20%20...%20on%20Index%20%7B%0A%20%20%20%20%20%20title%0A%20%20%20%20%20%20userID%0A%20%20%20%20%20%20createdAt%0A%20%20%20%20%20%20links(first%3A10%0A%20%20%20%20%20%20)%20%7B%0A%20%20%20%20%20%20%20%20edges%20%7B%0A%20%20%20%20%20%20%20%20%20%20node%20%7B%0A%20%20%20%20%20%20%20%20%20%20%20%20id%0A%20%20%20%20%20%20%20%20%20%20%20%20title%0A%20%20%20%20%20%20%20%20%20%20%7D%0A%20%20%20%20%20%20%20%20%7D%0A%20%20%20%20%20%20%7D%0A%20%20%20%20%7D%0A%20%20%7D%0A%7D

Update Index

Update Link

Delete Link

Delete Index