from dataclasses import dataclass, field
from typing import Optional, List
from enum import Enum

@dataclass
class Index:
  id: str
  title: str
  signer_function: str
  signer_public_key: str
  did_owned: bool
  did_starred: bool
  roles_owner: bool
  roles_creator: bool
  owner_did: 'User'
  created_at: str
  updated_at: str
  deleted_at: Optional[str] = None
  links: List['Link'] = field(default_factory=list)

@dataclass
class User:
  id: str
  name: Optional[str] = None
  bio: Optional[str] = None
  avatar: Optional[str] = None
  created_at: Optional[str] = None
  updated_at: Optional[str] = None

@dataclass
class Link:
  id: str
  index_id: Optional[str] = None
  indexer_did: Optional[str] = None
  content: Optional[str] = None
  title: Optional[str] = None
  url: Optional[str] = None
  description: Optional[str] = None
  language: Optional[str] = None
  favicon: Optional[str] = None
  created_at: Optional[str] = None
  updated_at: Optional[str] = None
  deleted_at: Optional[str] = None
  images: List[str] = field(default_factory=list)
  favorite: bool = False
  tags: List[str] = field(default_factory=list)

class Participant(Enum):
  User = "user"
  Assistant = "assistant"

@dataclass
class Message:
  content: str
  role: Participant
